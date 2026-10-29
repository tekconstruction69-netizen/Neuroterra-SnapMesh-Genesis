'use strict';

/**
 * ComputeNode : pont entre le transport (SnapMeshNode) et le calcul.
 * - Exécutant : sur TASK vérifié, exécute une op de la liste blanche et
 *   répond RESULT. Jamais de code arbitraire.
 * - Coordinateur : submit() dispatche selon l'ordonnanceur, collecte les
 *   RESULT, applique timeouts/réaffectations et tranche via verifier.
 * Protocole versionné : TASK {v:1,…}, RESULT {v:1,…}.
 */

const { runOp } = require('./ops');
const { hashOf, DedupStore } = require('snapmesh-mesh-flux/src/dedup');
const { pack, unpack } = require('snapmesh-mesh-flux/src/flux');
const { selectEncoding } = require('snapmesh-mesh-flux/src/policy');
const { Sandbox } = require('./sandbox');
const { TaskQueue } = require('./tasks');
const { schedulers } = require('./sched');
const { decide } = require('./verifier');

const TASK_V = 1;

class ComputeNode {
  constructor(node, { scheduler = 'round-robin', sabotage = false, dropResults = false, queueFile = null, recoverDelayMs = 3000, admit = null, sandbox = null, sandboxOpts = null, museOpts = null, brake = null, flux = null, excludeSelf = false } = {}) {
    this.admit = admit; // garde-fou optionnel : (op, coordinatorId, taskId) => bool
    // §4 : toute exécution d'une tâche réseau passe par le bac à sable
    // (worker borné). Instance injectable pour les tests.
    this.sandbox = sandbox || new Sandbox(sandboxOpts || {});
    if (!schedulers[scheduler]) throw new Error(`ordonnanceur-inconnu: ${scheduler}`);
    this.node = node;
    this.schedName = scheduler;
    this.sched = schedulers[scheduler];
    this.schedState = {};
    this.sabotage = sabotage; // TEST UNIQUEMENT : renvoie des résultats faux
    this.dropResults = dropResults; // TEST UNIQUEMENT : exécute mais ne répond jamais (panne silencieuse)
    this.excludeSelf = excludeSelf === true; // TEST/DÉMO : coordinateur jamais exécutant
    this.queue = new TaskQueue({ persistPath: queueFile });
    this.pending = new Map(); // taskId -> {resolve, task} (soumissions de ce processus)
    this.recovered = new Set(); // taskIds reprises après redémarrage (sans promesse en attente)
    this.load = new Map(); // executorId -> affectations en cours (vue coordinateur)
    this.stats = { rejected: {} };
    this.history = []; // §6 : verdicts récents pour l'entrée du planificateur (capé)
    this.museOpts = museOpts || {}; // {apiKey?, apiUrl?, model?, fetchImpl?, budgets?}
    this.museCalls = 0; // appels distants réellement émis (budget)
    this.proofs = new Map(); // §7 : taskId -> reçus acceptés (versés au verdict, puis purgés)
    // NT-Flux (opt-in, défaut OFF : comportement M1/M2 inchangé sans lui).
    // flux: {enabled, effort, maxDecompressedBytes, maxCompressedBytes,
    //        storeOpts:{maxEntries,maxBytes,ttlMs}, net:{bytesPerSec,rttMs}}
    const fo = flux || {};
    this.fluxCfg = {
      enabled: fo.enabled === true,
      effort: fo.effort || 'normal',
      maxDecompressedBytes: fo.maxDecompressedBytes || 4 * 1024 * 1024,
      maxCompressedBytes: fo.maxCompressedBytes || 2 * 1024 * 1024,
      storeOpts: fo.storeOpts || {},
      net: fo.net || {},
    };
    this.fluxKnown = new Map(); // coordinateur : execId -> Set(hash confirmés par ack)
    this.fluxRecv = new Map(); // exécutant : coordId -> DedupStore (partition par expéditeur)
    this.fluxRefs = new Map(); // coordinateur : taskId -> Map(execId -> hash) (renvoi plein)
    if (this.fluxCfg.enabled && this.node.capsExtra && typeof this.node.capsExtra === 'object') {
      // Annonce NT-CAP du support (fusion, jamais d'écrasement) : un pair
      // sans annonce reçoit du M2 pur (aucune tâche ne dépend du flux).
      this.node.capsExtra = { ...this.node.capsExtra, flux: { codecs: ['raw', 'deflate', 'gzip', 'brotli'] } };
    }
    // §8 : frein du contrôleur safety — consulté avant TOUT placement
    // (tous ordonnanceurs, Muse inclus) : STOP/SUSPENDED/ERROR = pas de
    // nouvelle affectation, même en reprise. Format : () => {go, reason?}.
    this.brake = brake;
    /** Vrai si le contrôleur autorise un nouveau placement. */
    this.brakeCheck = () => {
      if (!this.brake) return { go: true, reason: null };
      try {
        const b = this.brake();
        return { go: b.go !== false, reason: b.reason || null };
      } catch {
        return { go: false, reason: 'frein-illisible' };
      }
    };
    this.recoverDelayMs = recoverDelayMs;
    this.queue.onEvent = (e) => this._onQueueEvent(e);
    node.on('message', (m) => this._onMessage(m));
    node.on('dead', ({ id }) => this._onExecutorDead(id));
    const resumed = this.queue.load();
    if (resumed.length) {
      // Reprise : laisse la découverte retrouver les pairs avant de re-dispatcher.
      setTimeout(() => this._recover(resumed), this.recoverDelayMs);
    }
  }

  /** Re-dispatch les tâches interrompues par un arrêt ; résultats déjà reçus conservés. */
  _recover(tasks) {
    let n = 0;
    for (const task of tasks) {
      if (task.state === 'done' || task.state === 'failed') continue;
      this.recovered.add(task.id);
      n++;
      const want = Math.min(task.redundancy - task.results.size, this.candidates().length);
      for (let i = 0; i < want; i++) this._dispatch(task);
      this._evaluate(task);
    }
    this.node.emit('recovered', { tasks: n });
  }

  // ---------- exécutant ----------

  _onMessage({ type, from, payload, encrypted, relayed }) {
    if (type === 'TASK') this._handleTask(from, payload, { encrypted: encrypted === true, relayed: relayed === true });
    else if (type === 'RESULT') this._handleResult(from, payload, { encrypted: encrypted === true, relayed: relayed === true });
  }

  async _handleTask(coordinatorId, p, meta = {}) {
    if (!p || p.v !== TASK_V || typeof p.taskId !== 'string' || typeof p.op !== 'string') return;
    if (this.admit && !this.admit(p.op, coordinatorId, p.taskId)) {
      this.node.emit('exec-refused', { taskId: p.taskId, op: p.op, from: coordinatorId });
      return; // garde-fou safety : refus technique, pas déclaratif
    }
    // P8 : le STOP local vaut aussi côté exécutant (pas seulement au
    // placement). Refus silencieux : le coordinateur réaffecte après
    // timeout (délai documenté, pas de canal de refus dans le protocole).
    if (this.brakeCheck && !this.brakeCheck().go) {
      this.node.emit('exec-refused', { taskId: p.taskId, op: p.op, from: coordinatorId, reason: 'frein' });
      return;
    }
    // NT-Flux : décodage (ref → store partitionné par expéditeur ; flux →
    // décompression gardée ; plains → directs). Tout échec = refus
    // silencieux (le coordinateur réaffecte), jamais d'exécution partielle.
    const decoded = this._fluxDecode(coordinatorId, p);
    if (!decoded.ok) {
      this.stats.sandboxRefused = (this.stats.sandboxRefused || 0) + 1;
      this.node.emit('exec-failed', { taskId: p.taskId, op: p.op, from: coordinatorId, error: decoded.error });
      return;
    }
    const args = decoded.args;
    this.node.emit('exec', { taskId: p.taskId, op: p.op, from: coordinatorId, encrypted: meta.encrypted, relayed: meta.relayed, sandboxed: true });
    let result;
    let durationMs = 0;
    try {
      const r = await this.sandbox.run(p.op, args); // §4 : worker borné
      result = r.result;
      durationMs = r.durationMs;
    } catch (e) {
      // Timeout, crash, annulation, op inconnue ou args invalides : refus
      // silencieux, rien n'est renvoyé (le coordinateur réaffecte sur timeout,
      // comme pour une panne d'exécutant).
      this.stats.sandboxRefused = (this.stats.sandboxRefused || 0) + 1;
      this.node.emit('exec-failed', { taskId: p.taskId, op: p.op, from: coordinatorId, error: (e && e.code) || 'sandbox-error' });
      return;
    }
    if (this.sabotage) result = corrupt(result);
    if (this.dropResults) return; // panne silencieuse simulée : exécuté, jamais répondu
    // §7 : reçu signé liant charge, résultat et exécutant (imputabilité).
    // Les empreintes portent sur les args DÉCODÉS (originaux après flux).
    const { stableHash, makeReceipt } = require('./receipts');
    const res = {
      v: TASK_V, taskId: p.taskId, op: p.op, result, durationMs,
      inHash: stableHash(args), outHash: stableHash(result),
      receipt: null, sig: null,
      dedupAck: this.fluxCfg.enabled && decoded.hash ? [decoded.hash] : [],
    };
    if (this.node.identity) {
      const made = makeReceipt(this.node.identity, {
        taskId: p.taskId, op: p.op, args, result, executor: this.node.id, durationMs,
      });
      res.receipt = made.receipt;
      res.sig = made.sig;
    }
    if (coordinatorId === this.node.id) {
      // Auto-réponse : livraison directe (aucun socket vers soi-même).
      this._handleResult(this.node.id, res);
    } else {
      // Canal chiffré quand la session X25519 est prête, sinon clair signalé.
      res.enc = this.node.sessionKeys?.has(coordinatorId) === true;
      this.node.sendEncrypted(coordinatorId, 'RESULT', res);
    }
  }

  // ---------- coordinateur ----------

  candidates() {
    // NT-ID : seuls les pairs à session vérifiée (défi réussi) exécutent.
    // excludeSelf (test/démo --no-self) : force l'exécution distante.
    const live = this.node.registry.live();
    const selfCaps = this.node.caps();
    const out = this.excludeSelf ? [] : [{
      id: this.node.id, cpus: cpuCount(selfCaps), load: this.load.get(this.node.id) || 0,
      memFreeBytes: memFree(selfCaps),
    }];
    for (const p of live) {
      if (p.id !== this.node.id && !this.node.registry.isSessionVerified(p.id)) continue;
      out.push({
        id: p.id, cpus: p.caps?.cpus || cpuCount(p.caps), load: this.load.get(p.id) || 0,
        memFreeBytes: memFree(p.caps),
      });
    }
    return out;
  }

  submit(op, args, { redundancy = 1, timeoutMs = 8000, onlyIds = null } = {}) {
    // Validation stricte AVANT diffusion : op/args/redondance/timeout.
    // runOp lève sur op inconnue ou args invalides ; Task lève sur
    // redondance/timeout hors bornes. Rien n'est diffusé en cas d'échec.
    // onlyIds (§5) : restreint le placement aux exécutants éligibles (minRes).
    const task = this.queue.submit(
      { op, args, redundancy, timeoutMs, coordinatorId: this.node.id },
      (o, a) => runOp(o, a)
    );
    return new Promise((resolve) => {
      this.pending.set(task.id, { resolve, task });
      const n = Math.min(task.redundancy, this.candidates().length);
      if (n === 0) return this._settle(task, 'failed', null, [], []);
      for (let i = 0; i < n; i++) this._dispatch(task, [], onlyIds);
    });
  }

  // ---------- §5 : jobs DAG ----------

  /**
   * Exécute un DAG validé, vague par vague (fragments prêts en parallèle),
   * chaque fragment via submit() (donc quorum/vérification/timeout/reprise
   * inchangés), puis fusionne par le merge nommé. Ne lève jamais : tout
   * échec est dans le verdict retourné.
   */
  async submitDag(dag, { jobId = null } = {}) {
    const {
      validateDag, topoOrder, substituteRefs, eligibleIds, MERGES,
    } = require('./fragments');
    const id = jobId || `job-${Date.now().toString(36)}-${(this.jobSeq = (this.jobSeq || 0) + 1)}`;
    try {
      validateDag(dag);
    } catch (e) {
      return { jobId: id, outcome: 'failed', value: null, error: String((e && e.message) || e).slice(0, 300), fragments: [] };
    }
    const t0 = Date.now();
    const order = topoOrder(dag);
    const values = new Map(); // fragmentId -> valeur vérifiée
    const fragProofs = new Map(); // fragmentId -> faisceau §7
    const reports = [];
    const finished = new Set(); // tentés (done ou failed)
    let failed = null;

    const execFrag = async (f) => {
      const v = f.validation || { strategy: 'single', redundancy: 1 };
      const base = { id: f.id, op: f.op, attempts: 0, executedBy: [] };
      if (Date.now() - t0 > f.expiryMs) {
        return { ...base, outcome: 'expired', error: 'fragment-expired' };
      }
      const eligible = eligibleIds(this.candidates(), f.minRes);
      if (!eligible.length) {
        return { ...base, outcome: 'no-capacity', error: 'aucun exécutant éligible (minRes)' };
      }
      let args;
      try {
        args = substituteRefs(f.args, values);
      } catch (e) {
        return { ...base, outcome: 'bad-ref', error: String((e && e.message) || e).slice(0, 200) };
      }
      let res;
      try {
        res = await this.submit(f.op, args, { redundancy: v.redundancy, timeoutMs: f.timeoutMs, onlyIds: eligible });
      } catch (e) {
        // Validation pré-diffusion (args substitués invalides) : rien diffusé.
        return { ...base, outcome: 'invalid-args', error: String((e && e.message) || e).slice(0, 200) };
      }
      if (res.outcome !== 'done') {
        return { ...base, outcome: 'failed', attempts: res.attempts, executedBy: res.agreeing || [], error: `tâche ${res.outcome}` };
      }
      // §7 : le faisceau du fragment ne retient que les reçus des exécutants
      // qui fondent la valeur (agreeing), empreintes re-contrôlées ici.
      const { stableHash } = require('./receipts');
      const inHash = stableHash(args);
      const outHash = stableHash(res.value);
      const receipts = (res.proofs || [])
        .filter((pr) => (res.agreeing || []).includes(pr.executor))
        .map((pr) => ({ executor: pr.executor, sig: pr.sig, verified: pr.verified === true }));
      if (!receipts.length && (res.agreeing || []).length) {
        return { ...base, outcome: 'failed', attempts: res.attempts, executedBy: res.agreeing || [], error: 'preuve manquante (aucun reçu)' };
      }
      for (const pr of res.proofs || []) {
        if (!(res.agreeing || []).includes(pr.executor)) continue; // dissident : audité ailleurs
        if (pr.outHash !== outHash || pr.inHash !== inHash) {
          return { ...base, outcome: 'failed', attempts: res.attempts, executedBy: res.agreeing || [], error: 'proof-mismatch (empreinte)' };
        }
      }
      values.set(f.id, res.value);
      fragProofs.set(f.id, { id: f.id, op: f.op, inHash, outHash, executedBy: res.agreeing || [], attempts: res.attempts, receipts });
      return { ...base, outcome: 'done', value: res.value, attempts: res.attempts, executedBy: res.agreeing || [] };
    };

    while (finished.size < dag.fragments.length && !failed) {
      const ready = order.filter((f) => !finished.has(f.id) && f.deps.every((d) => values.has(d)));
      if (!ready.length) {
        failed = 'deadlock: dépendances insatisfaites';
        break;
      }
      const wave = await Promise.all(ready.map(execFrag));
      for (const r of wave) {
        finished.add(r.id);
        reports.push(r);
        this.node.emit(r.outcome === 'done' ? 'frag-done' : 'frag-failed', { jobId: id, ...r });
        if (r.outcome !== 'done' && !failed) failed = `${r.id}: ${r.error || r.outcome}`;
      }
    }
    for (const f of dag.fragments) {
      if (!finished.has(f.id)) reports.push({ id: f.id, op: f.op, outcome: 'skipped', attempts: 0, executedBy: [] });
    }
    if (failed) {
      const job = { jobId: id, outcome: 'failed', value: null, error: failed, fragments: reports };
      this.node.emit('job', job);
      return job;
    }
    let value;
    try {
      const ordered = dag.fragments.map((f) => ({ id: f.id, value: values.get(f.id) }));
      value = MERGES[dag.merge](ordered, dag.partCount ?? dag.fragments.length);
    } catch (e) {
      const job = { jobId: id, outcome: 'failed', value: null, error: `merge: ${String((e && e.message) || e).slice(0, 200)}`, fragments: reports };
      this.node.emit('job', job);
      return job;
    }
    // §7 : réponse finale vérifiable — valeur + empreintes + reçus signés.
    const { stableHash: sh } = require('./receipts');
    const job = {
      jobId: id, outcome: 'done', value, error: null, fragments: reports,
      verification: {
        jobId: id,
        merge: dag.merge,
        finalHash: sh(value),
        mergedAt: Date.now(),
        fragments: dag.fragments.map((f) => fragProofs.get(f.id)),
      },
    };
    this.node.emit('job', job);
    return job;
  }

  _dispatch(task, exclude = [], onlyIds = null) {
    if (task.state === 'done' || task.state === 'failed') return; // déjà tranchée
    // §8 : le frein prime sur tout ordonnanceur (y compris Muse) et sur
    // les reprises : pas de nouvelle affectation sans contribution autorisée.
    const bc = this.brakeCheck();
    if (!bc.go) {
      this.stats.brakeDenied = (this.stats.brakeDenied || 0) + 1;
      this.node.emit('brake-denied', { taskId: task.id, op: task.op, reason: bc.reason || 'frein' });
      this._settle(task, 'failed', null, [], []);
      return;
    }
    const tried = new Set([...task.assignments.keys(), ...exclude]);
    const pool = this.candidates().filter((c) => !tried.has(c.id) && (!onlyIds || onlyIds.includes(c.id)));
    if (!pool.length) {
      this._evaluate(task); // plus personne : trancher avec ce qu'on a
      return;
    }
    const id = this.sched.pick({ ...taskSnapshot(task, this.history), coordinatorId: this.node.id }, pool, this.schedState);
    if (!id) {
      this._evaluate(task);
      return;
    }
    // §6 : observabilité du plan (ordonnanceur muse : heuristique validée ou repli).
    if (this.schedName === 'muse' && this.schedState.lastPlan) {
      const plan = { taskId: task.id, op: task.op, picked: id, ...this.schedState.lastPlan };
      this.node.emit('plan', plan);
      if (plan.fallbackUsed) this.node.emit('plan-refused', plan);
    }
    this.load.set(id, (this.load.get(id) || 0) + 1);
    this.queue.assign(task, id, (t, execId) => this._onAssignTimeout(t, execId));
    if (id === this.node.id) {
      // Auto-exécution locale : args plains (le flux optimise le TRANSFERT,
      // pas le local) via le même chemin (validation incluse).
      this._handleTask(this.node.id, { v: TASK_V, taskId: task.id, op: task.op, args: task.args });
    } else {
      const body = this._fluxTaskBody(task, id);
      // Canal chiffré quand la session X25519 est prête, sinon clair signalé.
      const enc = this.node.sessionKeys?.has(id) === true;
      this.node.sendEncrypted(id, 'TASK', { v: TASK_V, taskId: task.id, op: task.op, timeoutMs: task.timeoutMs, enc, ...body });
    }
  }

  /**
   * NT-Flux côté coordinateur : ref (si confirmée) sinon enveloppe
   * compressée/sélectionnée, sinon args plains. Mémorise la ref pour
   * renvoi plein après invalidation. Sans flux : args plains (M2 pur).
   */
  /** Store dedup de CET expéditeur (partition anti-mélange). */
  _fluxStoreFor(coordinatorId) {
    let s = this.fluxRecv.get(coordinatorId);
    if (!s) {
      s = new DedupStore(this.fluxCfg.storeOpts);
      this.fluxRecv.set(coordinatorId, s);
    }
    return s;
  }

  /**
   * NT-Flux côté exécutant : résout ref/flux/plains vers les args.
   * Enregistre tout plein reçu (hash des BYTES JSON, ordre préservé) et
   * émet la stat de réception. Échec ⇒ {ok:false, error}.
   */
  _fluxDecode(coordinatorId, p) {
    const emit = (kind, codec, inBytes, outBytes, extra = {}) => {
      this.node.emit('flux-stats', { taskId: p.taskId, dir: 'recv', kind, codec, inBytes, outBytes, from: coordinatorId, ...extra });
    };
    if (typeof p.ref === 'string') {
      const data = this._fluxStoreFor(coordinatorId).get(p.ref);
      if (!data) {
        emit('ref-inconnue', 'none', p.ref.length, 0);
        return { ok: false, error: 'flux-unknown-ref' };
      }
      emit('ref', 'none', p.ref.length, data.length);
      try {
        return { ok: true, args: JSON.parse(data.toString('utf8')), hash: p.ref };
      } catch {
        return { ok: false, error: 'flux-ref-invalide' };
      }
    }
    if (p.flux && typeof p.flux === 'object') {
      let data;
      try {
        const r = unpack(p.flux, {
          maxDecompressedBytes: this.fluxCfg.maxDecompressedBytes,
          maxCompressedBytes: this.fluxCfg.maxCompressedBytes,
        });
        data = r.data;
        emit('flux', p.flux.codec || '?', r.metrics.inBytes, r.metrics.outBytes, { suspicious: !!r.metrics.suspicious });
      } catch (e) {
        return { ok: false, error: `flux-${String((e && e.message) || e).slice(0, 120)}` };
      }
      const h = hashOf(data);
      this._fluxStoreFor(coordinatorId).put(data);
      try {
        return { ok: true, args: JSON.parse(data.toString('utf8')), hash: h };
      } catch {
        return { ok: false, error: 'flux-charge-invalide' };
      }
    }
    // Args plains (M2 pur ou décision raw) : hashés et stockés aussi —
    // une future ref pourra les désigner.
    const rawBytes = Buffer.from(JSON.stringify(p.args), 'utf8');
    const h = hashOf(rawBytes);
    if (this.fluxCfg.enabled) this._fluxStoreFor(coordinatorId).put(rawBytes);
    emit(this.fluxCfg.enabled ? 'plein' : 'plein-legacy', 'raw', rawBytes.length, rawBytes.length);
    return { ok: true, args: p.args, hash: h };
  }

  /** Le pair supporte-t-il NT-Flux (annonce NT-CAP) ? */
  _peerFlux(id) {
    if (!this.fluxCfg.enabled) return false;
    if (id === this.node.id) return true;
    const live = this.node.registry.live().find((p) => p.id === id);
    return !!((live && live.caps && live.caps.flux && live.caps.flux.codecs && live.caps.flux.codecs.length));
  }

  _fluxTaskBody(task, id) {
    if (!this.fluxCfg.enabled) return { args: task.args };
    if (!this._peerFlux(id)) {
      // Pair sans annonce : M2 pur (kind tracé pour l'audit).
      const n = Buffer.byteLength(JSON.stringify(task.args), 'utf8');
      this.node.emit('flux-stats', { taskId: task.id, dir: 'send', kind: 'plein-legacy', codec: 'raw', inBytes: n, outBytes: n, to: id });
      return { args: task.args };
    }
    const rawBytes = Buffer.from(JSON.stringify(task.args), 'utf8');
    const h = hashOf(rawBytes);
    const known = this.fluxKnown.get(id);
    if (known && known.has(h)) {
      if (!this.fluxRefs.has(task.id)) this.fluxRefs.set(task.id, new Map());
      this.fluxRefs.get(task.id).set(id, h);
      this.node.emit('flux-stats', { taskId: task.id, dir: 'send', kind: 'ref', codec: 'none', inBytes: rawBytes.length, outBytes: h.length, to: id });
      return { ref: h };
    }
    const env = pack(rawBytes, {
      effort: this.fluxCfg.effort,
      net: this.fluxCfg.net,
      maxDecompressedBytes: this.fluxCfg.maxDecompressedBytes,
      maxCompressedBytes: this.fluxCfg.maxCompressedBytes,
    });
    if (env.codec === 'raw') {
      // Pas de gain : args plains SANS enveloppe (zéro surcoût base64).
      this.node.emit('flux-stats', { taskId: task.id, dir: 'send', kind: 'plein', codec: 'raw', inBytes: rawBytes.length, outBytes: rawBytes.length, to: id });
      return { args: task.args };
    }
    this.node.emit('flux-stats', {
      taskId: task.id, dir: 'send', kind: 'flux',
      codec: env.codec, inBytes: env.metrics.inBytes, outBytes: env.metrics.outBytes, to: id,
    });
    return { flux: env };
  }

  _handleResult(from, p, meta = {}) {
    if (!p || p.v !== TASK_V || typeof p.taskId !== 'string') return;
    const task = this.queue.get(p.taskId);
    if (!task) return; // tâche inconnue : ignoré
    if (meta.encrypted) this.stats.encryptedResults = (this.stats.encryptedResults || 0) + 1;
    // NT-Flux : accusés de réception (le pair détient ces fragments — les
    // prochaines charges identiques partiront en ref). Indépendant du vote.
    if (Array.isArray(p.dedupAck) && p.dedupAck.length) {
      let known = this.fluxKnown.get(from);
      if (!known) {
        known = new Set();
        this.fluxKnown.set(from, known);
      }
      for (const h of p.dedupAck) {
        if (typeof h === 'string' && h.length === 64) known.add(h);
      }
    }
    // §7 : vérification du reçu AVANT tout vote (liaison charge↔résultat↔expéditeur).
    const receiptCheck = this._checkReceipt(task, from, p);
    if (receiptCheck !== 'ok') {
      this.stats.rejected[receiptCheck] = (this.stats.rejected[receiptCheck] || 0) + 1;
      this.node.emit('rejected-result', { reason: receiptCheck, taskId: p.taskId, from });
      return;
    }
    // Contrôles stricts : seul un résultat sollicité modifie votes/charge/verdict.
    const verdict = this.queue.recordResult(task, from, p.result, p.durationMs, { op: p.op });
    if (verdict !== 'accepted') {
      this.stats.rejected[verdict] = (this.stats.rejected[verdict] || 0) + 1;
      this.node.emit('rejected-result', { reason: verdict, taskId: p.taskId, from });
      return;
    }
    // Reçu accepté : archivé pour le faisceau de preuve (purge au verdict).
    if (p.receipt && p.sig) {
      if (!this.proofs.has(p.taskId)) {
        if (this.proofs.size >= 500) {
          const oldest = this.proofs.keys().next().value;
          this.proofs.delete(oldest);
          this.stats.proofsDropped = (this.stats.proofsDropped || 0) + 1;
        }
        this.proofs.set(p.taskId, []);
      }
      this.proofs.get(p.taskId).push({
        executor: from, inHash: p.inHash, outHash: p.outHash,
        durationMs: p.durationMs, sig: p.sig, verified: true,
      });
    }
    this.load.set(from, Math.max(0, (this.load.get(from) || 1) - 1));
    this._evaluate(task);
  }

  /**
   * §7 : contrôle du reçu d'exécution. Retourne 'ok' ou un motif de rejet
   * (compté + signalé, sans vote). Règles : reçu + signature exigés sauf
   * chemin local sans identité (tests/stubs) ; clé connue exigée ; liaison
   * (expéditeur, tâche, empreintes) vérifiée octet par octet.
   */
  _checkReceipt(task, from, p) {
    const { stableHash, verifyReceipt } = require('./receipts');
    const pub = (this.node.knownPub && this.node.knownPub.get(from))
      || (from === this.node.id && this.node.identity ? this.node.identity.spkiDer : null);
    if (!p.receipt || !p.sig) {
      // Chemin local hérité (nœud sans identité, tests) : accepté, sans preuve.
      if (from === this.node.id && !this.node.identity) return 'ok';
      return 'missing-receipt';
    }
    if (!pub) return 'unknown-receipt-key';
    if (p.receipt.executor !== from) return 'bad-receipt';
    if (p.receipt.taskId !== p.taskId || p.receipt.op !== p.op) return 'bad-receipt';
    if (!verifyReceipt(p.receipt, p.sig, pub)) return 'bad-receipt';
    if (p.inHash !== p.receipt.inHash || p.outHash !== p.receipt.outHash) return 'bad-receipt';
    if (p.receipt.inHash !== stableHash(task.args)) return 'bad-receipt';
    if (p.receipt.outHash !== stableHash(p.result)) return 'bad-receipt';
    return 'ok';
  }

  _evaluate(task) {
    if (task.state === 'done' || task.state === 'failed') return;
    if (!this.pending.has(task.id) && !this.recovered.has(task.id)) return;
    // M2 : on attend TOUTES les affectations dispatchées (réponse ou
    // expiration) avant de trancher — verdict déterministe et complet
    // (tous les dissidents connus). La détection de panne (dead) coupe
    // court à l'attente via réaffectation immédiate.
    const outstanding = [...task.assignments.values()].some((a) => a.state === 'assigned');
    if (outstanding) return;
    const results = [...task.results.entries()].map(([executorId, r]) => ({ executorId, result: r.result }));
    if (task.redundancy === 1) {
      // Vérification indépendante : re-calcul local du coordinateur.
      if (!results.length) {
        // M5 (pendaison j1 prouvée) : aucun résultat ET rien en vol
        // signifie que le dernier timeout a déjà consommé l'affectation.
        // Attendre encore serait un abandon silencieux : re-dispatch
        // (tentatives restantes) ou échec tranché — jamais de pendaison.
        const tried = new Set(task.assignments.keys());
        const untried = this.candidates().some((c) => !tried.has(c.id));
        if (untried && task.attempts < this.queue.maxAttempts) return this._dispatch(task);
        return this._settle(task, 'failed', null, [], []);
      }
      const [first] = results;
      let expected;
      try {
        expected = runOp(task.op, task.args);
      } catch {
        return this._settle(task, 'failed', null, [], []);
      }
      if (JSON.stringify(expected) === JSON.stringify(first.result)) {
        return this._settle(task, 'done', first.result, [first.executorId], []);
      }
      return this._settle(task, 'failed', null, [], [first.executorId]);
    }
    const d = decide(results, task.redundancy);
    if (d.outcome === 'agreed') return this._settle(task, 'done', d.value, d.agreeing, d.dissenting);
    if (d.outcome === 'disagree') return this._settle(task, 'failed', null, d.agreeing, d.dissenting);
    // insufficient + rien en vol : tenter un exécutant jamais essayé, sinon échec.
    const tried = new Set(task.assignments.keys());
    const untried = this.candidates().some((c) => !tried.has(c.id));
    if (untried && task.attempts < this.queue.maxAttempts) {
      return this._dispatch(task);
    }
    return this._settle(task, 'failed', null, d.agreeing, d.dissenting);
  }

  /** NT-Flux : après invalidation (timeout/panne), la ref a pu expirer
   * côté exécutant — on l'oublie : la prochaine tentative repart pleine.
   * C'est le prix de la simplicité (pas de renégociation) : correct,
   * jamais aveugle. */
  _fluxForget(task) {
    if (!task.fluxRefs || !task.fluxRefs.length) return;
    for (const [peer, known] of this.fluxKnown) {
      for (const h of task.fluxRefs) known.delete(h);
      if (known.size === 0) this.fluxKnown.delete(peer);
    }
    task.fluxRefs = [];
  }

  _onAssignTimeout(task, executorId) {
    this.load.set(executorId, Math.max(0, (this.load.get(executorId) || 1) - 1));
    if (!this.queue.executorFailed(task, executorId)) {
      return this._evaluate(task);
    }
    this._fluxForget(task);
    this._dispatch(task, [executorId]);
  }

  _onExecutorDead(id) {
    const live = new Set([
      ...[...this.pending.values()].map((e) => e.task),
      ...[...this.recovered].map((tid) => this.queue.get(tid)).filter(Boolean),
    ]);
    for (const task of live) {
      if (task.state === 'done' || task.state === 'failed') continue;
      if (!task.assignments.has(id)) continue;
      this.load.set(id, 0);
      if (this.queue.executorFailed(task, id)) {
        this._fluxForget(task);
        this._dispatch(task, [id]);
      } else this._evaluate(task);
    }
  }

  /**
   * §6 : décision de placement via l'adaptateur distant (Muse) avec repli.
   * N'ordonnance rien : retourne le plan validé pour exposition (app §9,
   * démos). Sans clé/URL configurées, rend le repli heuristique signalé.
   */
  async planWithMuse({ op, args = {}, redundancy = 1, timeoutMs = 8000, onlyIds = null } = {}) {
    const { buildPlacementInput, musePropose } = require('./muse');
    // §8 : aucune proposition quand le contrôleur ne contribue pas.
    const bc = this.brakeCheck();
    if (!bc.go) {
      const empty = { provider: 'none', reason: `frein: ${bc.reason || 'non autorisé'}`, explanation: null, confidence: null, executors: [], refusedProposal: null, fallbackUsed: true };
      this.node.emit('plan', { taskId: null, op, picked: null, ...empty });
      return empty;
    }
    let pool = this.candidates();
    if (onlyIds) pool = pool.filter((c) => onlyIds.includes(c.id));
    const input = buildPlacementInput({
      nodes: pool,
      queue: [{ taskId: `plan-${Date.now().toString(36)}`, op, args, redundancy, timeoutMs }],
      history: this.history,
      budgets: this.museOpts.budgets,
    });
    // Budget : chaque appel réellement émis compte, succès ou non.
    // P5 : plafonds aussi via environnement (jamais de secret en défaut ;
    // sans MUSE_API_URL, l'adaptateur rend le repli — jamais un appel).
    const rawFetch = this.museOpts.fetchImpl || null;
    const countingFetch = rawFetch ? (...a) => { this.museCalls++; return rawFetch(...a); } : null;
    const envMaxCalls = Number(process.env.MUSE_MAX_CALLS);
    const envTimeout = Number(process.env.MUSE_TIMEOUT_MS);
    const envBudgets = {
      // '0' = aucun appel distant (utile en test / mode verrouillé).
      maxCalls: Number.isInteger(envMaxCalls) && envMaxCalls >= 0 ? envMaxCalls : undefined,
      timeoutMs: Number.isInteger(envTimeout) && envTimeout > 0 ? envTimeout : undefined,
    };
    const budgets = {
      ...(envBudgets.maxCalls ? { maxCalls: envBudgets.maxCalls } : {}),
      ...(envBudgets.timeoutMs ? { timeoutMs: envBudgets.timeoutMs } : {}),
      ...(this.museOpts.budgets || {}),
    };
    const r = await musePropose(input, {
      fetchImpl: countingFetch,
      apiUrl: this.museOpts.apiUrl || process.env.MUSE_API_URL || null,
      apiKey: this.museOpts.apiKey || process.env.MUSE_API_KEY || null,
      model: this.museOpts.model || process.env.MUSE_MODEL || 'muse',
      callsUsed: this.museCalls,
      budgets: Object.keys(budgets).length ? budgets : undefined,
      redundancy,
    });
    const plan = {
      provider: r.provider,
      reason: r.reason,
      explanation: r.proposal.explanation,
      confidence: r.proposal.confidence,
      executors: (r.proposal.assignments[0] || { executors: [] }).executors.filter((id) => pool.some((c) => c.id === id)),
      refusedProposal: r.refusedProposal || null,
    };
    // P5 : journal des décisions (capé) — le provider est TOUJOURS le
    // vrai (heuristic si repli, jamais 'muse' pour un fallback).
    const entry = {
      at: new Date().toISOString(), op, provider: r.provider,
      reason: r.reason || null, fallbackUsed: r.provider !== 'muse' && !!r.reason,
    };
    this.museLog = this.museLog || [];
    this.museLog.push(entry);
    if (this.museLog.length > 20) this.museLog.splice(0, this.museLog.length - 20);
    this.node.emit('plan', { taskId: input.queue[0].taskId, op, picked: plan.executors[0] || null, ...plan, fallbackUsed: entry.fallbackUsed });
    return plan;
  }

  _onQueueEvent(e) {
    void e;
  }

  _settle(task, state, value, agreeing, dissenting) {
    this.queue.settle(task, state);
    // §6 : makespan mesuré (jamais estimé) pour l'historique du planificateur.
    const makespanMs = Date.now() - (task.createdAt || Date.now());
    const outcome = {
      taskId: task.id,
      op: task.op,
      outcome: state,
      value,
      agreeing,
      dissenting,
      fraudSuspects: state === 'done' ? dissenting : [...dissenting, ...agreeing.filter((id) => state === 'failed')],
      attempts: task.attempts,
      makespanMs,
      scheduler: this.schedName,
      proofs: this.proofs.get(task.id) || [],
    };
    this.proofs.delete(task.id); // purge : le verdict porte le faisceau
    this.history.push({ taskId: task.id, op: task.op, scheduler: this.schedName, makespanMs, outcome: state, attempts: task.attempts });
    if (this.history.length > 20) this.history.splice(0, this.history.length - 20);
    const entry = this.pending.get(task.id);
    if (entry) {
      this.pending.delete(task.id);
      entry.resolve(outcome);
    } else if (this.recovered.has(task.id)) {
      this.recovered.delete(task.id);
      this.node.emit('recovered-task', outcome); // reprise : pas de promesse, un événement
    }
  }
}

function taskSnapshot(task, history = []) {
  return {
    id: task.id, op: task.op, args: task.args, redundancy: task.redundancy,
    timeoutMs: task.timeoutMs, coordinatorId: task.coordinatorId, history,
  };
}

function cpuCount(caps) {
  if (!caps) return 1;
  if (Number.isInteger(caps.cpus)) return caps.cpus; // format M1
  if (caps.cpu && Number.isInteger(caps.cpu.threads)) return caps.cpu.threads; // NT-CAP v2
  return 1;
}

/** RAM libre d'un profil NT-CAP v2 (null si inconnue → échec fermé si exigée). */
function memFree(caps) {
  if (!caps || !caps.ram) return null;
  return Number.isInteger(caps.ram.free) ? caps.ram.free : null;
}

/** Corruption déterministe pour les tests de fraude (sabotage). */
function corrupt(result) {
  if (typeof result === 'number') return result + 1;
  if (typeof result === 'string') return result + 'X';
  if (Array.isArray(result)) return [...result, '§saboté§'];
  if (result && typeof result === 'object') return { ...result, saboté: true };
  return '§saboté§';
}

module.exports = { ComputeNode, TASK_V };

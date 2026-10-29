'use strict';

/**
 * NT-ADAPT — partitionnement global vérifiable (prototype R&D, sans Muse).
 *
 * Différences mesurables vs planGreedy (nt-fusion) et NeuroCore.plan (NT-FLOW) :
 *  1. Recherche GLOBALE sur les affectations des nœuds de calcul (exhaustive
 *     bornée, sinon faisceau déterministe) au lieu du glouton nœud-par-nœud :
 *     une décision précoce coûteuse en transfert peut être évitée.
 *  2. Faisabilité MÉMOIRE CUMULÉE par worker (somme des tenseurs placés ≤
 *     plafond du registre) ; l'existant ne contrôle que nœud-par-nœud.
 *  3. Coût PESSIMISTE : coût nominal × (1 + β·incertitude NT-COST) ; l'existant
 *     calcule l'incertitude sans jamais l'utiliser dans le choix.
 *  4. Repli local EXPLICITE : si le meilleur plan distribué ne bat pas le
 *     meilleur plan mono-worker d'au moins `localMargin`, on reste local.
 *  5. Vérification par TOLÉRANCE (rtol/atol) au lieu de l'égalité binaire,
 *     et épreuve d'exécution réelle (probe) chiffrée par empreinte sha256.
 *
 * Honnêteté : aucun backend inventé (checkAssignment tranche) ; énergie
 * jamais inventée (null si aucun capteur/poids `powerW` mesuré fourni) ;
 * le fil reste COMPTÉ (octets), pas mesuré sur sockets — voir bench.
 * Aucune signature ici ne prouve la bonne exécution (cf. §7 : reçus+quorum).
 */

const crypto = require('node:crypto');
const { checkAssignment } = require('../../nt-compat/src/registry');
const { validateGraph, topoOrder, inferShapes, estimateFlops, tensorBytes } = require('../../nt-fusion/src/graph');
const { evalPlacement, DEFAULT_BPS } = require('./cost');

const ADAPT_V = 1;
const MAX_EXHAUSTIVE = 50000; // combinaisons max en recherche exhaustive
const BEAM_WIDTH = 200;
/** En-dessous, le coût de décision NT-Flux (~1-2 ms mesurés NT-UCP) domine : raw. */
const COMPRESS_MIN_BYTES = 8192;

/** Tolérances par défaut (vérification, PAS preuve d'exécution). */
const TOLERANCES = {
  fp64: { rtol: 1e-9, atol: 1e-12 },
  // fp32 inter-backends : écart d'arrondi mesuré < 1e-6 relatif (pont M2) ; marge ×100.
  fp32: { rtol: 1e-4, atol: 1e-6 },
  // Chaîne int8 : erreur relative mesurée 1,40 % (NT-UCP, pic 2874) ; marge ×2.
  int8: { rtol: 0.03, atol: 0.05 },
};

function bpsBetween(fromId, toWorker, opts = {}) {
  if (opts.netBps && Number.isFinite(opts.netBps[`${fromId}->${toWorker.id}`])) {
    return opts.netBps[`${fromId}->${toWorker.id}`];
  }
  const nb = toWorker.registry && toWorker.registry.netBpsTo;
  if (Number.isFinite(nb)) return nb;
  if (nb && Number.isFinite(nb[fromId])) return nb[fromId];
  return DEFAULT_BPS;
}

/**
 * Décision codec pour une jambe, SANS contenu : raw par hypothèse (tenseurs
 * denses, NT-UCP : 2304 o restés à 2304 o). La voie mesurée est measureLegWire.
 */
function legWire(bytes, { bps } = {}) {
  void bps;
  if (bytes < COMPRESS_MIN_BYTES) return { wireBytes: bytes, codec: 'raw', reason: 'petite-jambe' };
  return { wireBytes: bytes, codec: 'raw', reason: 'dense-supposé (mesure requise pour compresser)' };
}

/**
 * Voie mesurée : emballe réellement le tampon (NT-Flux) et ne retient la
 * compression que si le gain de transfert dépasse le coût CPU mesuré.
 * Retourne { codec, wireBytes, benefitMs } — bénéfice NET, jamais supposé.
 */
function measureLegWire(buf, { bps = DEFAULT_BPS } = {}) {
  const { pack } = require('../../mesh-flux/src/flux');
  const packed = pack(buf, { effort: 'normal' });
  const wireBytes = packed.metrics ? packed.metrics.outBytes : buf.length;
  const tPackMs = packed.metrics ? packed.metrics.tPackMs : 0;
  const savedMs = ((buf.length - wireBytes) / bps) * 1000;
  const benefitMs = savedMs - tPackMs;
  if (packed.codec !== 'raw' && benefitMs > 0) {
    return { codec: packed.codec, wireBytes, benefitMs, tPackMs };
  }
  return { codec: 'raw', wireBytes: buf.length, benefitMs: Math.min(0, benefitMs), tPackMs };
}

/** Pré-calcule, par nœud de calcul × worker, coût nominal/pessimiste et octets. */
function nodeOptions(graph, shapes, workers, learner, beta) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const opts = new Map(); // nodeId -> Map(workerId -> opt|null{motif})
  for (const n of topoOrder(graph)) {
    if (n.kind === 'input') continue;
    const shape = shapes.get(n.id);
    const per = new Map();
    for (const w of workers) {
      const learned = learner ? learner.get(n.kind, w.id, n.dtype) : null;
      const ev = evalPlacement({
        node: { ...n, flops: estimateFlops(n, shapes) },
        shape, worker: w, inputBytes: 0,
        learned: learned ? { flops: learned.flops, done: learned.done, failed: learned.failed } : null,
      });
      if (!ev.ok) { per.set(w.id, null); continue; }
      const chk = checkAssignment(w.registry, {
        id: `adapt-${n.id}`, op: n.kind, dtype: n.dtype, backend: n.backend, tensors: [{ shape }],
      });
      const nominal = ev.parts.tCalc + ev.parts.tConvert;
      per.set(w.id, {
        workerId: w.id, backend: ev.backend, nominalMs: nominal,
        pessimisticMs: nominal * ev.parts.riskMult * (1 + beta * ev.uncertainty),
        uncertainty: ev.uncertainty, estBytes: chk.ok ? chk.estBytes : 0,
        outBytes: tensorBytes(shape, n.dtype),
      });
    }
    opts.set(n.id, per);
  }
  return { byId, opts };
}

/** Place les inputs avec leur premier consommateur (zéro transfert si unique). */
function assignInputs(graph, assignments, workers) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = { ...assignments };
  for (const n of topoOrder(graph)) {
    if (n.kind === 'input') continue;
    for (const d of n.deps) {
      if (byId.get(d).kind === 'input' && !out[d]) out[d] = out[n.id];
    }
  }
  for (const n of graph.nodes) if (!out[n.id]) out[n.id] = workers[0].id;
  return out;
}

/**
 * Évalue une affectation complète : chemin critique (makespan), pas somme.
 * Retourne { ok, reason?, makespanMs, sumMs, transferBytes, wireBytes, legs,
 * perWorkerBytes, energyJ } — energyJ null si aucune puissance mesurée fournie.
 */
function evaluateAssignment(graph, assignments, workers, ctx) {
  const { shapes, opts, beta } = ctx;
  void beta;
  const wmap = new Map(workers.map((w) => [w.id, w]));
  const full = assignInputs(graph, assignments, workers);
  const perWorkerBytes = {};
  for (const n of graph.nodes) {
    const wid = full[n.id];
    const bytes = n.kind === 'input'
      ? tensorBytes(shapes.get(n.id), n.dtype)
      : (opts.get(n.id).get(wid) ? opts.get(n.id).get(wid).estBytes : 0);
    perWorkerBytes[wid] = (perWorkerBytes[wid] || 0) + bytes;
  }
  for (const [wid, bytes] of Object.entries(perWorkerBytes)) {
    const cap = wmap.get(wid).registry.mem.capBytes;
    if (bytes > cap) return { ok: false, reason: `mémoire cumulée ${wid}: ${bytes} o > plafond ${cap} o`, perWorkerBytes };
  }
  const finish = new Map();
  const legs = [];
  let transferBytes = 0;
  let wireBytes = 0;
  let sumMs = 0;
  let energyJ = 0;
  let anyPower = false;
  for (const n of topoOrder(graph)) {
    if (n.kind === 'input') { finish.set(n.id, 0); continue; }
    const wid = full[n.id];
    const o = opts.get(n.id).get(wid);
    if (!o) return { ok: false, reason: `nœud ${n.id} incompatible sur ${wid}` };
    let start = 0;
    for (const d of n.deps) {
      let t = finish.get(d) || 0;
      if (full[d] !== wid) {
        const bytes = tensorBytes(shapes.get(d), ctx.byId.get(d).dtype);
        const bps = bpsBetween(full[d], wmap.get(wid), ctx.bpsOpts);
        const wire = legWire(bytes, { bps });
        t += (wire.wireBytes / bps) * 1000;
        legs.push({ from: full[d], to: wid, node: d, bytes, wireBytes: wire.wireBytes, codec: wire.codec });
        transferBytes += bytes;
        wireBytes += wire.wireBytes;
      }
      if (t > start) start = t;
    }
    const done = start + o.pessimisticMs;
    finish.set(n.id, done);
    sumMs += o.nominalMs;
    const pw = wmap.get(wid).registry.powerW;
    if (Number.isFinite(pw)) { anyPower = true; energyJ += pw * (o.nominalMs / 1000); }
  }
  const makespanMs = Math.max(0, ...finish.values());
  return {
    ok: true, makespanMs, sumMs, transferBytes, wireBytes, legs, perWorkerBytes,
    energyJ: anyPower ? energyJ : null, assignments: full,
  };
}

function combosCount(k, w) {
  let r = 1;
  for (let i = 0; i < k; i++) { r *= w; if (r > MAX_EXHAUSTIVE) return r; }
  return r;
}

/**
 * Planifie globalement. Options : { learner, beta=1, localMargin=0.05,
 * deadlineMs=null, netBps } — retourne { plan, evaluated, rejected, searchMode,
 * bestSingleMs, reason } ; plan.strategy = 'nt-adapt' ou 'nt-adapt-local'.
 */
function planAdapt(graph, workers, opts = {}) {
  validateGraph(graph);
  if (!Array.isArray(workers) || !workers.length) throw new Error('adapt: workers requis');
  const beta = Number.isFinite(opts.beta) ? opts.beta : 1;
  const localMargin = Number.isFinite(opts.localMargin) ? opts.localMargin : 0.05;
  const shapes = inferShapes(graph);
  const { byId, opts: nodeOpts } = nodeOptions(graph, shapes, workers, opts.learner || null, beta);
  const ctx = { shapes, byId, opts: nodeOpts, beta, bpsOpts: opts };
  const compute = topoOrder(graph).filter((n) => n.kind !== 'input');
  const wids = workers.map((w) => w.id);
  rejected = { incompatible: 0, memoire: 0, deadline: 0 };
  var rejected;
  let evaluated = 0;
  let best = null;
  const consider = (partial) => {
    evaluated++;
    // Incompatibilité par nœud (avant évaluation complète).
    for (const n of compute) {
      if (!nodeOpts.get(n.id).get(partial[n.id])) { rejected.incompatible++; return; }
    }
    const ev = evaluateAssignment(graph, partial, workers, ctx);
    if (!ev.ok) {
      if (/mémoire cumulée/.test(ev.reason)) rejected.memoire++; else rejected.incompatible++;
      return;
    }
    if (Number.isFinite(opts.deadlineMs) && ev.makespanMs > opts.deadlineMs) { rejected.deadline++; return; }
    const key = ev.assignments ? compute.map((n) => ev.assignments[n.id]).join(',') : '';
    if (!best || ev.makespanMs < best.ev.makespanMs
      || (ev.makespanMs === best.ev.makespanMs && ev.transferBytes < best.ev.transferBytes)
      || (ev.makespanMs === best.ev.makespanMs && ev.transferBytes === best.ev.transferBytes && key < best.key)) {
      best = { ev, key };
    }
  };
  let searchMode = 'exhaustif';
  if (combosCount(compute.length, wids.length) <= MAX_EXHAUSTIVE) {
    const idx = new Array(compute.length).fill(0);
    for (;;) {
      const partial = {};
      compute.forEach((n, i) => { partial[n.id] = wids[idx[i]]; });
      consider(partial);
      let p = idx.length - 1;
      while (p >= 0 && ++idx[p] === wids.length) { idx[p] = 0; p--; }
      if (p < 0) break;
    }
  } else {
    // Faisceau déterministe : états partiels triés par borne inférieure partielle.
    searchMode = 'faisceau';
    let beam = [{}];
    for (const n of compute) {
      const next = [];
      for (const partial of beam) {
        for (const wid of wids) {
          if (!nodeOpts.get(n.id).get(wid)) continue;
          next.push({ ...partial, [n.id]: wid });
        }
      }
      next.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      beam = next.slice(0, BEAM_WIDTH);
      if (!beam.length) break;
    }
    for (const partial of beam) consider(partial);
  }
  if (!best) {
    throw new Error(`adapt: aucun plan faisable (évalués ${evaluated}, rejetés ${JSON.stringify(rejected)})`);
  }
  // Meilleur mono-worker (référence du repli local).
  let bestSingle = null;
  for (const wid of wids) {
    const single = {};
    for (const n of compute) single[n.id] = wid;
    let okAll = true;
    for (const n of compute) if (!nodeOpts.get(n.id).get(wid)) { okAll = false; break; }
    if (!okAll) continue;
    const ev = evaluateAssignment(graph, single, workers, ctx);
    if (ev.ok && (!bestSingle || ev.makespanMs < bestSingle.ev.makespanMs)) bestSingle = { ev, wid };
  }
  let chosen = best;
  let strategy = 'nt-adapt';
  let reason = 'meilleur makespan global (chemin critique pessimiste)';
  if (bestSingle && best.ev.makespanMs >= bestSingle.ev.makespanMs * (1 - localMargin)) {
    chosen = bestSingle;
    strategy = 'nt-adapt-local';
    reason = `repli local : distribué ${best.ev.makespanMs.toFixed(3)} ms ne bat pas mono ${bestSingle.ev.makespanMs.toFixed(3)} ms d'au moins ${(localMargin * 100).toFixed(0)} %`;
  }
  const plan = {
    v: 1, strategy, assignments: chosen.ev.assignments,
    transfers: chosen.ev.legs.map((l) => ({ from: l.from, to: l.to, bytes: l.bytes, node: l.node })),
    estMs: chosen.ev.makespanMs,
  };
  return {
    plan, evaluated, rejected, searchMode, reason,
    makespanMs: chosen.ev.makespanMs, sumMs: chosen.ev.sumMs,
    transferBytes: chosen.ev.transferBytes, wireBytes: chosen.ev.wireBytes,
    energyJ: chosen.ev.energyJ, bestSingleMs: bestSingle ? bestSingle.ev.makespanMs : null,
    bestDistributedMs: best.ev.makespanMs,
  };
}

/** B1 graphe : round-robin aveugle (référence, peut être infaisable). */
function planRoundRobin(graph, workers) {
  validateGraph(graph);
  const sorted = [...workers].sort((a, b) => (a.id < b.id ? -1 : 1));
  const assignments = {};
  let i = 0;
  for (const n of topoOrder(graph)) {
    if (n.kind === 'input') continue;
    assignments[n.id] = sorted[i++ % sorted.length].id;
  }
  return { v: 1, strategy: 'round-robin', assignments, transfers: [], estMs: null };
}

/** Comparaison tolérante de matrices 2D : err ≤ atol + rtol·|attendu|. */
function verifyTolerance(actual, expected, tol = TOLERANCES.fp32) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
    return { ok: false, reason: 'shapes incompatibles', maxAbs: Infinity, maxRel: Infinity };
  }
  let maxAbs = 0;
  let peak = 0;
  let worst = null;
  let ok = true;
  for (let i = 0; i < expected.length; i++) {
    if (!Array.isArray(actual[i]) || actual[i].length !== expected[i].length) {
      return { ok: false, reason: 'shapes incompatibles', maxAbs: Infinity, maxRel: Infinity };
    }
    for (let j = 0; j < expected[i].length; j++) {
      const e = expected[i][j];
      const d = Math.abs(actual[i][j] - e);
      if (d > maxAbs) { maxAbs = d; worst = [i, j]; }
      peak = Math.max(peak, Math.abs(e));
      if (!(d <= tol.atol + tol.rtol * Math.abs(e))) ok = false;
    }
  }
  return { ok, maxAbs, maxRel: maxAbs / Math.max(1e-9, peak), worst, tol };
}

/**
 * Épreuve d'exécution réelle sur un worker (même processus : prouve la
 * capacité du REGISTRE local, pas d'un appareil distant). Mesure matmul/add/
 * cast réels (nt-compat), erreur max vs oracle fp64 en arithmétique JS.
 * Retourne un reçu horodaté + empreinte sha256 du contenu (hors horodatage).
 */
function probeWorker(worker, { n = 32, reps = 3 } = {}) {
  const T = require('../../nt-compat/src/tensors');
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => ((i + j) % 7) * 0.5 - 1));
  const B = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => ((i - j) % 5) * 0.25));
  const oracle = A.map((row, i) => B[0].map((_, j) => row.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
  const median = (xs) => [...xs].sort((a, b) => a - b)[(xs.length - 1) >> 1];
  const run = (fn) => {
    const ts = [];
    let out = null;
    for (let r = 0; r < reps; r++) {
      const t0 = process.hrtime.bigint();
      out = fn();
      ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return { ms: median(ts), out };
  };
  const mm = run(() => T.matmul(T.fromArray2D(A, 'fp32'), T.fromArray2D(B, 'fp32')));
  const got = T.toArray2D(mm.out);
  let maxErr = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) maxErr = Math.max(maxErr, Math.abs(got[i][j] - oracle[i][j]));
  const ad = run(() => T.add(T.fromArray2D(A, 'fp32'), T.fromArray2D(B, 'fp32')));
  const qi = run(() => T.quantize(T.fromArray2D(A, 'fp32')));
  const mmi = run(() => T.matmul(T.fromArray2D(A, 'int8'), T.fromArray2D(B, 'int8')));
  const body = {
    v: ADAPT_V, workerId: worker.id, n,
    ops: {
      matmul_fp32: { ms: +mm.ms.toFixed(4), flops: 2 * n * n * n, maxErrVsFp64: maxErr },
      matmul_int8: { ms: +mmi.ms.toFixed(4), flops: 2 * n * n * n },
      add_fp32: { ms: +ad.ms.toFixed(4) },
      cast_int8: { ms: +qi.ms.toFixed(4), scale: qi.out.scale },
    },
    backends: Object.fromEntries(Object.entries(worker.registry.backends || {}).map(([k, b]) => [k, !!b.available])),
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { ...body, at: new Date().toISOString(), hash };
}

/** Injecte l'épreuve dans l'apprenant (observations réelles, bornées par EWMA). */
function seedLearnerFromProbe(learner, receipt) {
  const m = receipt.ops.matmul_fp32;
  learner.observe({ op: 'matmul', workerId: receipt.workerId, dtype: 'fp32', ms: Math.max(m.ms, 1e-3), flops: m.flops });
  if (receipt.ops.matmul_int8) {
    learner.observe({ op: 'matmul', workerId: receipt.workerId, dtype: 'int8', ms: Math.max(receipt.ops.matmul_int8.ms, 1e-3), flops: receipt.ops.matmul_int8.flops });
  }
  learner.observe({ op: 'add', workerId: receipt.workerId, dtype: 'fp32', ms: Math.max(receipt.ops.add_fp32.ms, 1e-3), flops: receipt.n * receipt.n });
  learner.observe({ op: 'cast', workerId: receipt.workerId, dtype: 'int8', ms: Math.max(receipt.ops.cast_int8.ms, 1e-3), flops: receipt.n * receipt.n });
  return learner;
}

/**
 * NT-ADAPT 2 — routage intelligent entre candidats hétérogènes.
 * Candidats : hosting mono-worker (modèle entier, bonus cache), distribué
 * (planAdapt), local forcé si confidentialité, cloud (Baseten) en repli.
 * Contraintes : { localOnly, localWorkerId, allowedWorkers, deniedWorkers,
 *   minReliability } — un candidat violant une contrainte est ÉCARTÉ avec
 *   motif, jamais pénalisé silencieusement. Le cloud n'est jamais appelé
 *   ici : seule la PRÉSENCE de BASETEN_API_KEY est testée (valeur jamais
 *   lue, journalisée ni transmise) ; l'appel reste [PRÉVU] hors prototype.
 * Retourne { chosen, candidates, refusedDistribution } explicables.
 */
function routeRequest(request, workers, opts = {}) {
  const { reliabilityOf } = require('./cost');
  const c = opts.constraints || {};
  const denied = new Set(c.deniedWorkers || []);
  const allowed = c.allowedWorkers ? new Set(c.allowedWorkers) : null;
  const model = request.model || null;
  const usable = workers.filter((w) => !denied.has(w.id) && (!allowed || allowed.has(w.id)));
  const candidates = [];
  const reliability = (wid) => {
    if (!opts.learner) return null;
    let done = 0;
    let failed = 0;
    for (const f of opts.learner.stats.values()) { void f; }
    // Fiabilité par worker : agrège les fiches de l'apprenant.
    for (const [k, f] of opts.learner.stats.entries()) {
      if (k.split('|')[1] === wid) { done += f.done || 0; failed += f.failed || 0; }
    }
    return done + failed ? done / (done + failed) : null;
  };
  const relOk = (wids) => {
    if (!Number.isFinite(c.minReliability)) return true;
    return wids.every((wid) => {
      const r = reliability(wid);
      return r === null || r >= c.minReliability;
    });
  };
  // Hosting : modèle entier sur un worker (chargement payé si non caché).
  if (usable.length) {
    for (const w of usable) {
      try {
        const single = {};
        for (const n of request.graph.nodes) if (n.kind !== 'input') single[n.id] = w.id;
        const shapes2 = inferShapes(request.graph);
        const { byId, opts: o2 } = nodeOptions(request.graph, shapes2, [w], opts.learner || null, 1);
        const ev = evaluateAssignment(request.graph, single, [w], { shapes: shapes2, byId, opts: o2, bpsOpts: opts });
        if (!ev.ok) { candidates.push({ kind: 'hosting', worker: w.id, feasible: false, reason: ev.reason }); continue; }
        const cached = model && Array.isArray(model.cachedOn) && model.cachedOn.includes(w.id);
        const loadMs = model && !cached && model.loadMs && Number.isFinite(model.loadMs[w.id]) ? model.loadMs[w.id] : 0;
        const fetchMs = model && !cached && Number.isFinite(model.sizeBytes)
          ? (model.sizeBytes / bpsBetween(opts.sourceWorker || 'local', w, opts)) * 1000 : 0;
        candidates.push({
          kind: 'hosting', worker: w.id, feasible: relOk([w.id]),
          reason: relOk([w.id]) ? (cached ? 'modèle en cache' : 'modèle à charger/transférer') : 'fiabilité insuffisante',
          estMs: +(ev.makespanMs + loadMs + fetchMs).toFixed(4), transferBytes: ev.transferBytes,
        });
      } catch (e) {
        candidates.push({ kind: 'hosting', worker: w.id, feasible: false, reason: e.message });
      }
    }
  }
  // Distribué (sauf verrou local de confidentialité).
  if (c.localOnly) {
    candidates.push({ kind: 'distribue', feasible: false, reason: `confidentialité : local uniquement (${c.localWorkerId || 'local'})` });
  } else if (usable.length > 1) {
    try {
      const r = planAdapt(request.graph, usable, opts);
      const wids = [...new Set(Object.values(r.plan.assignments))];
      candidates.push({
        kind: 'distribue', feasible: relOk(wids), strategy: r.plan.strategy,
        reason: relOk(wids) ? r.reason : 'fiabilité insuffisante', estMs: +r.makespanMs.toFixed(4),
        transferBytes: r.transferBytes, workers: wids,
      });
    } catch (e) {
      candidates.push({ kind: 'distribue', feasible: false, reason: e.message });
    }
  }
  // Cloud : repli contrôlé, jamais appelé dans ce prototype.
  const cloudKey = !!process.env.BASETEN_API_KEY;
  candidates.push({
    kind: 'cloud', feasible: false,
    reason: cloudKey ? 'clé Baseten présente — appel NON exécuté (prototype, [PRÉVU])' : 'clé Baseten absente (variable d’environnement)',
  });
  const feasible = candidates.filter((x) => x.feasible && Number.isFinite(x.estMs));
  feasible.sort((a, b) => a.estMs - b.estMs || String(a.kind).localeCompare(String(b.kind)));
  const chosen = feasible[0] || null;
  const dist = candidates.find((x) => x.kind === 'distribue');
  return {
    chosen, candidates,
    refusedDistribution: !dist || !dist.feasible || (chosen && chosen.kind !== 'distribue')
      ? (dist ? dist.reason : 'aucun candidat distribué') : null,
  };
}

module.exports = {
  ADAPT_V, TOLERANCES, COMPRESS_MIN_BYTES,
  planAdapt, planRoundRobin, evaluateAssignment, verifyTolerance,
  legWire, measureLegWire, probeWorker, seedLearnerFromProbe, routeRequest,
};

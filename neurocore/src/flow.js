'use strict';

/**
 * NT-FLOW — moteur autonome NeuroCore (AUCUN appel Muse, aucun fetch).
 * Pipeline : demande → classification → graphe typé → plan au coût
 * total appris → exécution réelle → observation (learn) → replan
 * secours sur panne → vérification (re-calcul du final) → restitution.
 * Chaque décision est journalisée (explicable/auditable). Le frein
 * safety (brake) est consulté avant tout placement ET toute exécution ;
 * un refus redirige vers un autre worker ou échoue proprement.
 */

const { validateGraph, topoOrder, inferShapes, estimateFlops, tensorBytes } = require('../../nt-fusion/src/graph');
const { executeGraph } = require('../../nt-fusion/src/execute');
const { validatePlan } = require('../../nt-fusion/src/planner');
const { evalPlacement } = require('./cost');
const { Learner } = require('./learn');

const FLOW_V = 1;

/** Classification : preset ou graphe explicite (jamais de code). */
const PRESETS = ['chain-matmul-fp32', 'mixed-fp32-int8', 'batch-add'];
function classify(request) {
  if (!request || typeof request !== 'object') throw new Error('neurocore: demande objet requise');
  if (request.graph) {
    validateGraph(request.graph);
    return { kind: 'graphe-explicite', graph: request.graph };
  }
  if (!PRESETS.includes(request.preset)) throw new Error(`neurocore: preset inconnu (${PRESETS.join('|')}) ou graphe requis`);
  return { kind: request.preset, graph: buildPreset(request.preset, request.params || {}) };
}

function mat(n, f) {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
}

function buildPreset(preset, params) {
  const n = Number.isInteger(params.n) && params.n >= 2 && params.n <= 64 ? params.n : 8;
  if (preset === 'chain-matmul-fp32') {
    return { v: 1, nodes: [
      { id: 'A', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(n, (i, j) => i + j + 1) } },
      { id: 'B', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(n, (i, j) => (i - j) * 0.5) } },
      { id: 'mm1', kind: 'matmul', dtype: 'fp32', deps: ['A', 'B'], in: { a: { $node: 'A' }, b: { $node: 'B' } } },
      { id: 'C', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(n, () => 1) } },
      { id: 'mm2', kind: 'matmul', dtype: 'fp32', deps: ['mm1', 'C'], in: { a: { $node: 'mm1' }, b: { $node: 'C' } } },
    ]};
  }
  if (preset === 'mixed-fp32-int8') {
    return { v: 1, nodes: [
      { id: 'A', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(n, (i, j) => (i + j) * 0.5) } },
      { id: 'B', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(n, (i, j) => (i - j) * 0.25) } },
      { id: 'mm', kind: 'matmul', dtype: 'fp32', deps: ['A', 'B'], in: { a: { $node: 'A' }, b: { $node: 'B' } } },
      { id: 'qi', kind: 'cast', dtype: 'int8', deps: ['mm'], in: { x: { $node: 'mm' } } },
      { id: 'C', kind: 'input', dtype: 'int8', deps: [], params: { values: mat(n, (i, j) => ((i + j) % 5) - 2) } },
      { id: 'mm2', kind: 'matmul', dtype: 'int8', deps: ['qi', 'C'], in: { a: { $node: 'qi' }, b: { $node: 'C' } } },
      { id: 'qf', kind: 'cast', dtype: 'fp32', deps: ['mm2'], in: { x: { $node: 'mm2' } } },
      { id: 'D', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(n, () => 1) } },
      { id: 'out', kind: 'add', dtype: 'fp32', deps: ['qf', 'D'], in: { a: { $node: 'qf' }, b: { $node: 'D' } } },
    ]};
  }
  // batch-add : deux additions indépendantes + somme (parallélisme réel).
  return { v: 1, nodes: [
    { id: 'A', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(n, (i, j) => i + j) } },
    { id: 'B', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(n, (i, j) => i * j) } },
    { id: 'C', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(n, () => 2) } },
    { id: 'D', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(n, () => 3) } },
    { id: 's1', kind: 'add', dtype: 'fp32', deps: ['A', 'B'], in: { a: { $node: 'A' }, b: { $node: 'B' } } },
    { id: 's2', kind: 'add', dtype: 'fp32', deps: ['C', 'D'], in: { a: { $node: 'C' }, b: { $node: 'D' } } },
    { id: 'out', kind: 'add', dtype: 'fp32', deps: ['s1', 's2'], in: { a: { $node: 's1' }, b: { $node: 's2' } } },
  ]};
}

class NeuroCore {
  constructor({ workers = [], brake = null, learner = null, strategy = 'legacy', adaptOpts = {} } = {}) {
    if (!Array.isArray(workers) || !workers.length) throw new Error('neurocore: workers requis');
    this.workers = workers;
    this.strategy = strategy; // 'legacy' (défaut, inchangé) | 'adapt' (NT-ADAPT)
    this.adaptOpts = adaptOpts;
    this.brake = brake; // () => {go, reason?} — indépendant de l'ordonnanceur
    this.learner = learner || new Learner();
    this.decisions = []; // journal borné (explicabilité)
    this.overheadMs = { plan: 0, verify: 0 }; // surcharge mesurée de l'orchestrateur
  }
  log(kind, detail) {
    this.decisions.push({ at: new Date().toISOString(), kind, ...detail });
    if (this.decisions.length > 100) this.decisions.splice(0, this.decisions.length - 100);
  }
  brakeCheck() {
    if (!this.brake) return { go: true, reason: null };
    try {
      const b = this.brake();
      return { go: b.go !== false, reason: b.reason || null };
    } catch {
      return { go: false, reason: 'frein-illisible' };
    }
  }
  /** Planifie : coût total appris + hystérésis, arbitre NT-COST/compat. */
  plan(graph) {
    const t0 = process.hrtime.bigint();
    const bc = this.brakeCheck();
    if (!bc.go) throw new Error(`neurocore: placement refusé (${bc.reason || 'frein'})`);
    if (this.strategy === 'adapt') {
      const { planAdapt } = require('./adapt');
      const r = planAdapt(graph, this.workers, { learner: this.learner, ...this.adaptOpts });
      const v = validatePlan(graph, r.plan, this.workers);
      if (!v.ok) throw new Error(`neurocore: plan adapt invalide (${v.reason})`);
      this.overheadMs.plan += Number(process.hrtime.bigint() - t0) / 1e6;
      this.log('plan', { strategy: r.plan.strategy, estMs: +r.makespanMs.toFixed(3), transfers: r.plan.transfers.length, reason: r.reason });
      return r.plan;
    }
    validateGraph(graph);
    const shapes = inferShapes(graph);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const assignments = {};
    const transfers = [];
    let estMs = 0;
    for (const n of topoOrder(graph)) {
      if (n.kind === 'input') continue;
      const shape = shapes.get(n.id);
      const cands = [];
      for (const w of this.workers) {
        // Octets d'entrée depuis d'autres workers (coupe au cast : voir recompose).
        let inBytes = 0;
        for (const d of n.deps) {
          if (assignments[d] && assignments[d] !== w.id) {
            inBytes += tensorBytes(shapes.get(d), byId.get(d).dtype);
          }
        }
        const learned = this.learner.get(n.kind, w.id, n.dtype);
        const ev = evalPlacement({
          node: { ...n, flops: estimateFlops(n, shapes) },
          shape, worker: w, inputBytes: inBytes,
          learned: learned ? { flops: learned.flops, done: learned.done, failed: learned.failed } : null,
        });
        if (ev.ok) cands.push({ id: w.id, costMs: ev.costMs, ev });
      }
      if (!cands.length) throw new Error(`neurocore: aucun worker compatible pour ${n.id}`);
      const prev = this._lastPref && this._lastPref[n.kind];
      const pick = this.learner.prefer(prev || null, cands);
      // Mémorise la préférence (apprentissage de routage, pas de coût).
      this._lastPref = this._lastPref || {};
      this._lastPref[n.kind] = pick;
      const chosen = cands.find((c) => c.id === pick);
      assignments[n.id] = pick;
      estMs += chosen.costMs;
      for (const d of n.deps) {
        if (assignments[d] && assignments[d] !== pick) {
          transfers.push({ from: assignments[d], to: pick, bytes: tensorBytes(shapes.get(d), byId.get(d).dtype), node: d });
        }
      }
      // Inputs : avec leur premier consommateur (zéro transfert).
      for (const d of n.deps) {
        if (byId.get(d).kind === 'input' && !assignments[d]) assignments[d] = pick;
      }
      this.log('placement', { node: n.id, worker: pick, costMs: +chosen.costMs.toFixed(3), backend: chosen.ev.backend });
    }
    for (const n of graph.nodes) {
      if (!assignments[n.id]) assignments[n.id] = this.workers[0].id;
    }
    const plan = { v: 1, strategy: 'neurocore', assignments, transfers, estMs };
    const v = validatePlan(graph, plan, this.workers);
    if (!v.ok) throw new Error(`neurocore: plan invalide (${v.reason})`);
    this.overheadMs.plan += Number(process.hrtime.bigint() - t0) / 1e6;
    this.log('plan', { estMs: +estMs.toFixed(3), transfers: transfers.length });
    return plan;
  }
  /**
   * Exécute : plan → exécution réelle → observation → secours sur panne
   * (replan sans le worker fautif, reprise globale) → vérification
   * (re-calcul du nœud final, déterminisme) → restitution.
   */
  async run(request, { hooks = {} } = {}) {
    const { graph } = classify(request);
    const bc = this.brakeCheck();
    if (!bc.go) {
      return { outcome: 'refused', reason: bc.reason || 'frein', value: null, proofs: { decisions: this.decisions } };
    }
    const shapes = inferShapes(graph);
    let plan;
    try {
      plan = this.plan(graph);
    } catch (e) {
      return { outcome: 'failed', reason: e.message, value: null, proofs: { decisions: this.decisions } };
    }
    const deadWorkers = new Set();
    let result = null;
    let lastErr = null;
    for (let attempt = 0; attempt <= this.workers.length; attempt++) {
      try {
        result = await executeGraph(graph, { plan, hooks });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        // Panne : identifie le worker fautif (nœud en échec) et replanifie sans lui.
        const failedNode = e.nodeId;
        const wid = failedNode && plan.assignments[failedNode];
        if (wid) deadWorkers.add(wid);
        this.log('panne', { node: failedNode || '?', worker: wid || '?', attempt });
        const remaining = this.workers.filter((w) => !deadWorkers.has(w.id));
        if (!remaining.length) break;
        const saved = this.workers;
        this.workers = remaining;
        try {
          plan = this.plan(graph);
        } catch (pe) {
          this.workers = saved;
          lastErr = pe;
          break;
        }
        this.workers = saved;
        this.log('replan', { sans: [...deadWorkers], attempt });
      }
    }
    if (!result) {
      return { outcome: 'failed', reason: String((lastErr && lastErr.message) || lastErr), value: null, proofs: { decisions: this.decisions } };
    }
    // Observation : durées réelles par (op, worker, dtype).
    for (const [id, m] of Object.entries(result.metrics.nodes)) {
      const n = graph.nodes.find((x) => x.id === id);
      this.learner.observe({ op: n.kind, workerId: m.worker, dtype: n.dtype, ms: m.ms, ok: true, flops: estimateFlops(n, shapes) });
    }
    // Vérification : re-calcul du nœud final (déterminisme prouvé).
    const t0 = process.hrtime.bigint();
    const finals = topoOrder(graph).filter((n) => n.kind !== 'input');
    const last = finals[finals.length - 1];
    const check = await executeGraph(graph, { plan });
    const { toArray2D } = require('../../nt-compat/src/tensors');
    const a = JSON.stringify(toArray2D(result.values.get(last.id)));
    const b = JSON.stringify(toArray2D(check.values.get(last.id)));
    const verified = a === b;
    this.overheadMs.verify += Number(process.hrtime.bigint() - t0) / 1e6;
    this.log('vérification', { node: last.id, verified });
    if (!verified) {
      return { outcome: 'failed', reason: 'non-déterminisme détecté', value: null, proofs: { decisions: this.decisions } };
    }
    return {
      outcome: 'done', value: toArray2D(result.values.get(last.id)),
      proofs: {
        plan, metrics: result.metrics, verified,
        overheadMs: { ...this.overheadMs }, decisions: [...this.decisions],
      },
    };
  }
  /** État exportable pour reprise par un coordinateur temporaire (NT-SURVIVE). */
  exportState() {
    return { v: FLOW_V, learner: this.learner.toJSON(), decisions: this.decisions.slice(-20) };
  }
  static importState(workers, { learner, decisions }, { brake = null } = {}) {
    const nc = new NeuroCore({ workers, brake, learner: require('./learn').Learner.fromJSON(learner) });
    nc.decisions = decisions || [];
    return nc;
  }
}

module.exports = { FLOW_V, PRESETS, NeuroCore, classify, buildPreset };

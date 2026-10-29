'use strict';

/**
 * NT-FUSION — planificateur déterministe (secours et baseline).
 * Workers : [{ id, registry (nt-compat), netTo?: {workerId:{bytesPerSec}} }].
 * Coût(nœud → worker) = tCalcul (flops / flopsBackend) + Σ transferts
 * (octets entrées depuis autres workers / débit, défaut loopback mesuré
 * §bench NT-Flux : 25 Mio/s si inconnu — hypothèse documentée, pas mesure).
 * Choix : compatible le moins cher ; égalité → premier (déterministe).
 * Sortie : { v, assignments, transfers:[{from,to,bytes,node}], estMs }.
 * validatePlan : re-vérifie graphe + chaque affectation (nt-compat).
 */

const { checkAssignment } = require('../../nt-compat/src/registry');
const { validateGraph, topoOrder, inferShapes, estimateFlops, tensorBytes } = require('./graph');

const PLAN_V = 1;
const DEFAULT_BPS = 25 * 1024 * 1024;

function flopsOf(registry, backend) {
  const b = (registry.backends || {})[backend];
  return (b && Number.isFinite(b.flops) && b.flops > 0) ? b.flops : 1e6; // sans mesure : 1 Mflops (conservateur, signalé)
}

function planGreedy(g, workers, { netBps = null } = {}) {
  validateGraph(g);
  const shapes = inferShapes(g);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const assignments = {};
  const transfers = [];
  let estMs = 0;
  for (const n of topoOrder(g)) {
    if (n.kind === 'input') {
      // L'input vit là où son premier consommateur ira : différé.
      continue;
    }
    const shape = shapes.get(n.id);
    const flops = estimateFlops(n, shapes);
    let best = null;
    for (const w of workers) {
      const task = {
        id: `plan-${n.id}`, op: n.kind, dtype: n.dtype, backend: n.backend,
        tensors: [{ shape }],
      };
      const chk = checkAssignment(w.registry, task);
      if (!chk.ok) continue;
      const tCalc = (flops / flopsOf(w.registry, chk.backend)) * 1000;
      let tTrans = 0;
      const legs = [];
      for (const d of n.deps) {
        const wd = assignments[d];
        if (wd && wd !== w.id) {
          const s = shapes.get(d);
          const bytes = tensorBytes(s, byId.get(d).dtype);
          const bps = (netBps && netBps[`${wd}->${w.id}`]) || (w.registry.netBpsTo && w.registry.netBpsTo[wd]) || DEFAULT_BPS;
          tTrans += (bytes / bps) * 1000;
          legs.push({ from: wd, to: w.id, bytes, node: d });
        }
      }
      const cost = tCalc + tTrans;
      if (!best || cost < best.cost) best = { worker: w.id, backend: chk.backend, cost, legs, tCalc, tTrans };
    }
    if (!best) throw new Error(`planification: aucun worker compatible pour ${n.id} (${n.dtype}${n.backend ? '/' + n.backend : ''})`);
    assignments[n.id] = best.worker;
    for (const l of best.legs) transfers.push(l);
    estMs += best.cost;
    // Input : placé avec son premier consommateur (zéro transfert).
    for (const d of n.deps) {
      if (!assignments[d] && byId.get(d).kind === 'input') assignments[d] = best.worker;
    }
  }
  // Inputs sans consommateur (graphe dégénéré) : premier worker.
  for (const n of g.nodes) {
    if (n.kind === 'input' && !assignments[n.id]) assignments[n.id] = workers[0].id;
  }
  return { v: PLAN_V, strategy: 'greedy', assignments, transfers, estMs };
}

/** Re-vérifie un plan (graphe + compat de chaque affectation). */
function validatePlan(g, plan, workers) {
  const no = (reason) => ({ ok: false, reason });
  if (!plan || plan.v !== PLAN_V) return no('plan version attendue 1');
  let shapes;
  try {
    validateGraph(g);
    shapes = inferShapes(g);
  } catch (e) {
    return no(`graphe invalide : ${e.message}`);
  }
  const wmap = new Map(workers.map((w) => [w.id, w]));
  for (const n of g.nodes) {
    const wid = plan.assignments && plan.assignments[n.id];
    if (!wid) return no(`nœud ${n.id} non placé`);
    const w = wmap.get(wid);
    if (!w) return no(`worker inconnu ${wid} (${n.id})`);
    if (n.kind === 'input') continue;
    const chk = checkAssignment(w.registry, {
      id: `plan-${n.id}`, op: n.kind, dtype: n.dtype, backend: n.backend,
      tensors: [{ shape: shapes.get(n.id) }],
    });
    if (!chk.ok) return no(`nœud ${n.id} sur ${wid} : ${chk.reason}`);
    if (n.backend && chk.backend !== n.backend) return no(`nœud ${n.id} : backend ${chk.backend} ≠ exigé ${n.backend}`);
  }
  return { ok: true };
}

module.exports = { PLAN_V, DEFAULT_BPS, planGreedy, validatePlan };

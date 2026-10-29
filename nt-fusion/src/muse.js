'use strict';

/**
 * NT-FUSION — planificateur cognitif Muse (propose) + arbitre (dispose).
 * Même discipline que §6 : budgets d'appels, timeout avec course,
 * fetch injecté, JSON strict, repli heuristique SIGNALÉ, jamais d'exception.
 * Entrée : résumé du graphe, workers (capacités compatibles), coûts
 * observés, contraintes. Sortie : 1..3 plans {assignments, notes}.
 * Chaque plan proposé est validé par validatePlan AVANT tout usage.
 */

const { planGreedy, validatePlan } = require('./planner');
const { validateGraph, inferShapes } = require('./graph');

const FUSION_MUSE_V = 1;

function summarizeGraph(g) {
  validateGraph(g);
  const shapes = inferShapes(g);
  return {
    v: g.v,
    nodes: g.nodes.map((n) => ({
      id: n.id, kind: n.kind, dtype: n.dtype, deps: n.deps,
      shape: n.kind === 'input' ? shapes.get(n.id) : undefined,
      backend: n.backend || null,
      retryMax: n.retryMax || 0,
    })),
  };
}

function buildFusionInput({ graph, workers, observed = {}, constraints = {} }) {
  return {
    v: FUSION_MUSE_V,
    at: new Date().toISOString(),
    graph: summarizeGraph(graph),
    workers: workers.map((w) => ({
      id: w.id,
      backends: Object.entries((w.registry.backends || {}))
        .filter(([, b]) => b && b.available)
        .map(([name, b]) => ({ name, dtypes: b.dtypes || [], flops: b.flops || null })),
      threads: w.registry.threads,
      memCapBytes: w.registry.mem.capBytes,
    })),
    observed: {
      nodeMs: observed.nodeMs || {},
      bytesPerSec: observed.bytesPerSec ?? null, // mesuré, jamais inventé
    },
    constraints: {
      maxPlans: Math.min(3, Math.max(1, constraints.maxPlans || 2)),
      allowCrossWorker: constraints.allowCrossWorker !== false,
      explanationRequired: true,
    },
  };
}

/** Repli déterministe : greedy + round-robin sur compatibles. */
function fallbackPlans(input, graph, workers) {
  const plans = [];
  try {
    const greedy = planGreedy(graph, workers);
    plans.push({ ...greedy, strategy: 'greedy-fallback', explanation: 'repli : greedy coût min (déterministe).' });
  } catch (e) {
    return { plans: [], reason: `repli impossible : ${e.message}` };
  }
  // Round-robin : tourne sur les workers compatibles par nœud.
  const { topoOrder } = require('./graph');
  const { checkAssignment } = require('../../nt-compat/src/registry');
  const { inferShapes } = require('./graph');
  const shapes = inferShapes(graph);
  const assignments = {};
  let i = 0;
  for (const n of topoOrder(graph)) {
    if (n.kind === 'input') continue;
    const compat = workers.filter((w) => checkAssignment(w.registry, {
      id: `rr-${n.id}`, op: n.kind, dtype: n.dtype, backend: n.backend,
      tensors: [{ shape: shapes.get(n.id) }],
    }).ok);
    if (!compat.length) return { plans, reason: `nœud ${n.id} sans worker (round-robin)` };
    const w = compat[i % compat.length];
    i++;
    assignments[n.id] = w.id;
    for (const d of n.deps) {
      if (!assignments[d]) assignments[d] = w.id;
    }
  }
  for (const n of graph.nodes) {
    if (!assignments[n.id]) assignments[n.id] = workers[0].id;
  }
  // Jambes inter-workers (même comptage que le greedy : octets réels).
  const { tensorBytes } = require('./graph');
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const transfers = [];
  for (const n of graph.nodes) {
    if (n.kind === 'input') continue;
    for (const d of n.deps) {
      if (assignments[d] && assignments[d] !== assignments[n.id]) {
        transfers.push({ from: assignments[d], to: assignments[n.id], bytes: tensorBytes(shapes.get(d), byId.get(d).dtype), node: d });
      }
    }
  }
  plans.push({ v: 1, strategy: 'round-robin-fallback', assignments, transfers, estMs: null, explanation: 'repli : rotation équitable (déterministe).' });
  return { plans, reason: 'muse-indisponible (repli local)' };
}

function strictPlans(raw, maxPlans) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.plans)) return null;
  const plans = [];
  for (const p of raw.plans.slice(0, maxPlans)) {
    if (!p || typeof p !== 'object' || !p.assignments || typeof p.assignments !== 'object') return null;
    for (const [k, v] of Object.entries(p.assignments)) {
      if (typeof k !== 'string' || typeof v !== 'string') return null;
    }
    plans.push({ v: 1, strategy: 'muse', assignments: p.assignments, transfers: [], estMs: null, explanation: typeof p.explanation === 'string' ? p.explanation.slice(0, 500) : '' });
  }
  if (!plans.length) return null;
  if (typeof raw.explanation === 'string' && !plans[0].explanation) plans[0].explanation = raw.explanation.slice(0, 500);
  for (const p of plans) {
    if (!p.explanation) return null;
  }
  return plans;
}

async function proposeFusionPlans(input, graph, workers, { fetchImpl = null, apiUrl = null, apiKey = null, model = 'muse', callsUsed = 0, maxCalls = 10, timeoutMs = 8000 } = {}) {
  const local = () => {
    const fb = fallbackPlans(input, graph, workers);
    return { provider: 'heuristic', plans: fb.plans, reason: fb.reason, fallbackUsed: true };
  };
  if (!fetchImpl || !apiUrl || !apiKey) return local();
  if (callsUsed >= maxCalls) {
    const fb = fallbackPlans(input, graph, workers);
    return { provider: 'heuristic', plans: fb.plans, reason: 'budget-appels épuisé', fallbackUsed: true };
  }
  const prompt = `Tu es un planificateur de calcul distribué. Réponds UNIQUEMENT en JSON {"plans":[{"assignments":{"noeud":"worker"},"explanation":"..."}]}. Contraintes : 1..${input.constraints.maxPlans} plans, workers existants uniquement, nœuds tous placés.\nGraphe: ${JSON.stringify(input.graph)}\nWorkers: ${JSON.stringify(input.workers)}\nObservé: ${JSON.stringify(input.observed)}`;
  let res;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      res = await fetchImpl(apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0 }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    const fb = fallbackPlans(input, graph, workers);
    return { provider: 'heuristic', plans: fb.plans, reason: `muse-injoignable (${String((e && e.message) || e).slice(0, 80)})`, fallbackUsed: true };
  }
  let raw = null;
  try {
    const j = await res.json();
    const txt = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    raw = JSON.parse(txt);
  } catch {
    raw = null;
  }
  const plans = raw ? strictPlans(raw, input.constraints.maxPlans) : null;
  if (!plans) {
    const fb = fallbackPlans(input, graph, workers);
    return { provider: 'heuristic', plans: fb.plans, reason: 'réponse Muse invalide (JSON strict)', fallbackUsed: true };
  }
  // Arbitre : ne garde que les plans valides (compat re-vérifiée).
  const kept = plans.filter((p) => validatePlan(graph, p, workers).ok);
  if (!kept.length) {
    const fb = fallbackPlans(input, graph, workers);
    return { provider: 'heuristic', plans: fb.plans, reason: 'plans Muse invalides (arbitre)', fallbackUsed: true };
  }
  return { provider: 'muse', plans: kept, reason: `${kept.length}/${plans.length} plan(s) validé(s)`, fallbackUsed: false };
}

module.exports = { FUSION_MUSE_V, buildFusionInput, proposeFusionPlans, fallbackPlans };

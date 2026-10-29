'use strict';

/**
 * Tests §6 : orchestrateur Muse — contrats, arbitre, heuristique, adaptateur.
 * Aucun appel réseau réel : fetch injecté (stubs), clé absente par défaut.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MUSE_V, DEFAULT_BUDGETS, buildPlacementInput, validateProposal,
  heuristicPropose, musePropose,
} = require('../src/muse');

const NODES = [
  { id: 'n1', cpus: 8, load: 0 },
  { id: 'n2', cpus: 2, load: 3 },
];
const QUEUE = [{ taskId: 't1', op: 'fib', args: { n: 20 }, redundancy: 2, timeoutMs: 8000, state: 'pending' }];
const CTX = { taskIds: new Set(['t1']), connectedIds: new Set(['n1', 'n2']), provider: 'heuristic' };

test('contrat entrée v1 : forme exacte depuis candidats + file + historique', () => {
  const input = buildPlacementInput({
    nodes: NODES,
    queue: QUEUE,
    history: [{ taskId: 'h', op: 'fib', scheduler: 'local', makespanMs: 12, outcome: 'done', attempts: 1 }],
    budgets: { maxCalls: 3, timeoutMs: 1000 },
  });
  assert.equal(input.v, MUSE_V);
  assert.ok(!Number.isNaN(Date.parse(input.at)));
  assert.equal(input.nodes[0].state, 'connected');
  assert.equal(input.nodes[0].cpus, 8);
  assert.equal(input.queue[0].redundancy, 2);
  assert.equal(input.history[0].makespanMs, 12);
  assert.deepEqual(input.budgets, { maxCalls: 3, timeoutMs: 1000 });
});

test('arbitre : proposition valide acceptée', () => {
  const prop = {
    v: 1, provider: 'heuristic',
    assignments: [{ taskId: 't1', executors: ['n1', 'n2'] }],
    explanation: 'n1+n2 : capables, charge faible ; redondance 2.',
    confidence: 0.8, fallback: 'round-robin',
  };
  const r = validateProposal(prop, CTX);
  assert.equal(r.ok, true);
});

test('arbitre : exécutant inconnu, redondance hors bornes, confiance basse refusés', () => {
  const base = {
    v: 1, provider: 'heuristic',
    assignments: [{ taskId: 't1', executors: ['n1'] }],
    explanation: 'ok', confidence: 0.8, fallback: 'round-robin',
  };
  assert.match(validateProposal({ ...base, assignments: [{ taskId: 't1', executors: ['nX'] }] }, CTX).reason, /inconnu/);
  assert.match(validateProposal({ ...base, assignments: [{ taskId: 't1', executors: [] }] }, CTX).reason, /redondance/);
  assert.match(validateProposal({ ...base, confidence: 0.4 }, CTX).reason, /confiance/);
  assert.match(validateProposal({ ...base, assignments: [{ taskId: 'tX', executors: ['n1'] }] }, CTX).reason, /tâche/);
  assert.match(validateProposal({ ...base, v: 2 }, CTX).reason, /version/);
  // Tout refus désigne le repli (ici sur l'exécutant inconnu).
  const refused = validateProposal({ ...base, assignments: [{ taskId: 't1', executors: ['nX'] }] }, CTX);
  assert.equal(refused.ok, false);
  assert.equal(refused.fallback, 'round-robin');
});

test('arbitre : budget appels dépassé refusé pour provider muse', () => {
  const base = {
    v: 1, provider: 'muse',
    assignments: [{ taskId: 't1', executors: ['n1'] }],
    explanation: 'ok', confidence: 0.9, fallback: 'round-robin',
  };
  const ok = validateProposal(base, { ...CTX, provider: 'muse', callsUsed: 2, budgets: { maxCalls: 10 } });
  assert.equal(ok.ok, true);
  const ko = validateProposal(base, { ...CTX, provider: 'muse', callsUsed: 10, budgets: { maxCalls: 10 } });
  assert.equal(ko.ok, false);
  assert.match(ko.reason, /budget/);
});

test('heuristique : proposition valide, meilleurs d\u2019abord, explication', () => {
  const input = buildPlacementInput({ nodes: NODES, queue: QUEUE, history: [], budgets: DEFAULT_BUDGETS });
  const prop = heuristicPropose(input, { redundancy: 2 });
  assert.equal(prop.provider, 'heuristic');
  assert.deepEqual(prop.assignments[0].executors, ['n1', 'n2'], 'capacité décroissante');
  assert.ok(prop.explanation.length > 10);
  assert.ok(validateProposal(prop, CTX).ok);
  const prop1 = heuristicPropose(input, { redundancy: 1 });
  assert.deepEqual(prop1.assignments[0].executors, ['n1']);
});

test('adaptateur : sans clé ni fetch → repli heuristique signalé', async () => {
  const input = buildPlacementInput({ nodes: NODES, queue: QUEUE, history: [], budgets: DEFAULT_BUDGETS });
  const r = await musePropose(input, { apiKey: null, fetchImpl: null, apiUrl: 'http://x', callsUsed: 0, budgets: DEFAULT_BUDGETS });
  assert.equal(r.provider, 'heuristic');
  assert.match(r.reason, /indisponible|configuré/);
  assert.ok(validateProposal(r.proposal, CTX).ok, 'le repli doit passer l\u2019arbitre');
});

test('adaptateur : réponse Muse valide utilisée (fetch stub)', async () => {
  const input = buildPlacementInput({ nodes: NODES, queue: QUEUE, history: [], budgets: DEFAULT_BUDGETS });
  const museProp = {
    v: 1, assignments: [{ taskId: 't1', executors: ['n2', 'n1'] }],
    explanation: 'n2+n1 choisis (test)', confidence: 0.9, fallback: 'round-robin',
  };
  const fetchOk = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(museProp) } }] }) });
  const r = await musePropose(input, { apiKey: 'k-test', fetchImpl: fetchOk, apiUrl: 'http://muse.test', callsUsed: 0, budgets: DEFAULT_BUDGETS });
  assert.equal(r.provider, 'muse');
  assert.deepEqual(r.proposal.assignments[0].executors, ['n2', 'n1']);
});

test('adaptateur : JSON invalide, refus arbitre, timeout, budget → repli', async () => {
  const input = buildPlacementInput({ nodes: NODES, queue: QUEUE, history: [], budgets: DEFAULT_BUDGETS });
  const cfg = (fetchImpl, extra = {}) => ({ apiKey: 'k', fetchImpl, apiUrl: 'http://muse.test', callsUsed: 0, budgets: DEFAULT_BUDGETS, ...extra });
  const badJson = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'pas du json {' } }] }) });
  const r1 = await musePropose(input, cfg(badJson));
  assert.equal(r1.provider, 'heuristic');
  assert.match(r1.reason, /JSON|parse/i);
  const refused = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ v: 1, assignments: [{ taskId: 't1', executors: ['nX'] }], explanation: 'x', confidence: 0.9, fallback: 'round-robin' }) } }] }),
  });
  const r2 = await musePropose(input, cfg(refused));
  assert.equal(r2.provider, 'heuristic');
  assert.match(r2.reason, /arbitre/);
  const hanging = () => new Promise(() => {});
  const r3 = await musePropose(input, cfg(hanging, { budgets: { maxCalls: 10, timeoutMs: 50 } }));
  assert.equal(r3.provider, 'heuristic');
  assert.match(r3.reason, /timeout|délai/i);
  const r4 = await musePropose(input, cfg(badJson, { callsUsed: 10, budgets: { maxCalls: 10, timeoutMs: 5000 } }));
  assert.equal(r4.provider, 'heuristic');
  assert.match(r4.reason, /budget/);
});

test('historique : makespans mesurés alimentent l\u2019entrée du planificateur', async () => {
  const { EventEmitter } = require('node:events');
  const { ComputeNode } = require('../src/compute');
  const stub = new EventEmitter();
  stub.id = 'hist-tt';
  stub.registry = { live: () => [] };
  stub.caps = () => ({ cpus: 2 });
  stub._sendTo = () => false;
  stub.sendEncrypted = () => 'encrypted';
  const c = new ComputeNode(stub, { scheduler: 'muse' });
  const plans = [];
  stub.on('plan', (p) => plans.push(p));
  const r1 = await c.submit('fib', { n: 10 }, { redundancy: 1 });
  const r2 = await c.submit('fib', { n: 10 }, { redundancy: 1 });
  assert.equal(r1.outcome, 'done');
  assert.equal(r2.outcome, 'done');
  assert.ok(typeof r1.makespanMs === 'number' && r1.makespanMs >= 0);
  assert.equal(r1.scheduler, 'muse');
  assert.equal(c.history.length, 2, 'chaque verdict alimente l\u2019historique');
  assert.ok(c.history.every((h) => typeof h.makespanMs === 'number'));
  assert.ok(plans.length >= 2, 'chaque dispatch muse émet son plan');
  assert.ok(plans.every((p) => p.provider === 'heuristic' && p.fallbackUsed === false));
  const input = buildPlacementInput({ nodes: [{ id: 'x', cpus: 1, load: 0 }], queue: [], history: c.history, budgets: DEFAULT_BUDGETS });
  assert.equal(input.history.length, 2, 'l\u2019historique entre dans le contrat d\u2019entrée');
  await c.sandbox.shutdown();
});

test('ordonnanceur muse : enregistré, déterministe, repli round-robin si refus', () => {
  const { schedulers } = require('../src/sched');
  assert.ok(schedulers.muse, 'ordonnanceur muse manquant');
  const cands = [{ id: 'a', cpus: 1, load: 0 }, { id: 'b', cpus: 8, load: 0 }];
  const task = { id: 't', op: 'fib', redundancy: 1, history: [] };
  const s1 = {};
  const p1 = schedulers.muse.pick(task, cands, s1);
  assert.equal(p1, 'b', 'l\u2019heuristique choisit la capacité');
  assert.ok(s1.lastPlan && s1.lastPlan.provider === 'heuristic');
  assert.equal(s1.lastPlan.fallbackUsed, false);
  // Candidats vides de sens : l'arbitre refuse → repli déterministe.
  const s2 = {};
  const p2 = schedulers.muse.pick(task, [], s2);
  assert.equal(p2, null);
});

test('P5 : repli jamais étiqueté muse + journal des décisions', async () => {
  // P5 (audit) : sans clé/URL, planWithMuse rend provider 'heuristic'
  // avec fallbackUsed et motif — jamais 'muse'. Chaque décision est
  // journalisée (museLog capé) avec son vrai provider.
  const { EventEmitter } = require('node:events');
  const { ComputeNode } = require('../src/compute');
  const stub = new EventEmitter();
  stub.id = 'muse-p5';
  stub.registry = { live: () => [] };
  stub.caps = () => ({ cpus: 2 });
  const plans = [];
  stub.on('plan', (p) => plans.push(p));
  const c = new ComputeNode(stub, {});
  const p = await c.planWithMuse({ op: 'fib', args: { n: 10 } });
  assert.equal(p.provider, 'heuristic', 'repli présenté comme Muse');
  assert.equal(p.fallbackUsed || plans[0].fallbackUsed, true, 'repli non signalé');
  assert.ok((p.reason || plans[0].reason || '').length > 0, 'motif de repli absent');
  assert.equal(c.museLog.length, 1, 'décision non journalisée');
  assert.equal(c.museLog[0].provider, 'heuristic');
  assert.equal(c.museCalls, 0, 'appel compté sans fetch');
  // Plafond via env : maxCalls=0 → repli même avec fetch configuré.
  process.env.MUSE_MAX_CALLS = '0';
  const c2 = new ComputeNode(stub, { museOpts: { fetchImpl: async () => { throw new Error('ne-doit-pas-appeler'); } } });
  const p2 = await c2.planWithMuse({ op: 'fib', args: { n: 10 } });
  delete process.env.MUSE_MAX_CALLS;
  assert.equal(p2.provider, 'heuristic');
  assert.equal(c2.museCalls, 0, 'appel émis malgré budget 0');
  await c.sandbox.shutdown();
  await c2.sandbox.shutdown();
});

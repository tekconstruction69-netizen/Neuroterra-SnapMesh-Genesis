'use strict';

/**
 * NT-FUSION : validation, exécution exacte, planification, arbitre,
 * retry, Muse (repli + mock distant).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const G = require('../src/graph');
const { executeGraph } = require('../src/execute');
const { planGreedy, validatePlan } = require('../src/planner');
const M = require('../src/muse');
const { buildRegistry } = require('../../nt-compat/src/registry');

function workers2() {
  const r1 = buildRegistry({ detectOpts: { benchN: 8 } });
  const r2 = buildRegistry({ detectOpts: { benchN: 8 } });
  return [{ id: 'w1', registry: r1 }, { id: 'w2', registry: r2 }];
}

/** Chaîne fp32 : (A×B)+C, oracle indépendant (nombres JS). */
function chainGraph() {
  return {
    v: 1,
    nodes: [
      { id: 'A', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[1, 2], [3, 4]] } },
      { id: 'B', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[5, 6], [7, 8]] } },
      { id: 'C', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[1, 0], [0, 1]] } },
      { id: 'mm', kind: 'matmul', dtype: 'fp32', deps: ['A', 'B'], in: { a: { $node: 'A' }, b: { $node: 'B' } } },
      { id: 'out', kind: 'add', dtype: 'fp32', deps: ['mm', 'C'], in: { a: { $node: 'mm' }, b: { $node: 'C' } } },
    ],
  };
}

test('graphe : valide, shapes inférées, rejets stricts', () => {
  const g = chainGraph();
  assert.equal(G.validateGraph(g), true);
  const shapes = G.inferShapes(g);
  assert.deepEqual(shapes.get('out'), [2, 2]);
  assert.equal(G.estimateFlops(g.nodes[3], shapes), 16); // 2·2·2·2
  // Cycle.
  const cyc = { v: 1, nodes: [
    { id: 'a', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[1]] } },
    { id: 'x', kind: 'add', dtype: 'fp32', deps: ['y', 'a'], in: { a: { $node: 'y' }, b: { $node: 'a' } } },
    { id: 'y', kind: 'add', dtype: 'fp32', deps: ['x', 'a'], in: { a: { $node: 'x' }, b: { $node: 'a' } } },
  ]};
  assert.throws(() => G.validateGraph(cyc), /cycle/);
  // Conversion implicite interdite (fp32 consommé par int8 sans cast).
  const nocast = { v: 1, nodes: [
    { id: 'A', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[1, 2], [3, 4]] } },
    { id: 'B', kind: 'input', dtype: 'int8', deps: [], params: { values: [[1, 0], [0, 1]] } },
    { id: 'mm', kind: 'matmul', dtype: 'int8', deps: ['A', 'B'], in: { a: { $node: 'A' }, b: { $node: 'B' } } },
  ]};
  assert.throws(() => G.validateGraph(nocast), /sans cast/);
  // Shapes matmul incohérentes.
  const badmm = { v: 1, nodes: [
    { id: 'A', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[1, 2, 3]] } },
    { id: 'B', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[1, 2], [3, 4]] } },
    { id: 'mm', kind: 'matmul', dtype: 'fp32', deps: ['A', 'B'], in: { a: { $node: 'A' }, b: { $node: 'B' } } },
  ]};
  assert.throws(() => G.inferShapes(badmm), /matmul/);
  assert.throws(() => G.validateGraph({ v: 99, nodes: [] }), /v attendue/);
  assert.throws(() => G.validateGraph({ v: 1, nodes: [] }), /non vide/);
});

test('exécution : chaîne exacte vs oracle, métriques réelles', async () => {
  const { values, metrics } = await executeGraph(chainGraph());
  const got = values.get('out');
  assert.equal(got.dtype, 'fp32');
  // Oracle : (A×B)+I en nombres JS.
  const exp = [[1 * 5 + 2 * 7 + 1, 1 * 6 + 2 * 8], [3 * 5 + 4 * 7, 3 * 6 + 4 * 8 + 1]];
  const arr = got.data;
  assert.equal(arr[0], exp[0][0]);
  assert.equal(arr[3], exp[1][1]);
  assert.ok(metrics.totalMs >= 0 && Number.isFinite(metrics.totalMs));
  assert.ok(metrics.nodes.mm.bytes === 16, `octets mm : ${metrics.nodes.mm.bytes}`);
  assert.equal(metrics.nodes.mm.worker, 'local');
});

test('exécution : cast fp32→int8→calcul, erreur bornée, re-quantification', async () => {
  const g = { v: 1, nodes: [
    { id: 'A', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[1, 2], [3, 4]] } },
    { id: 'B', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[2, 0], [0, 2]] } },
    { id: 'qa', kind: 'cast', dtype: 'int8', deps: ['A'], in: { x: { $node: 'A' } } },
    { id: 'qb', kind: 'cast', dtype: 'int8', deps: ['B'], in: { x: { $node: 'B' } } },
    { id: 'mm', kind: 'matmul', dtype: 'int8', deps: ['qa', 'qb'], in: { a: { $node: 'qa' }, b: { $node: 'qb' } } },
    { id: 'mm2', kind: 'matmul', dtype: 'int8', deps: ['mm', 'qb'], in: { a: { $node: 'mm' }, b: { $node: 'qb' } } },
  ]};
  const { values } = await executeGraph(g);
  const { toArray2D } = require('../../nt-compat/src/tensors');
  const got = toArray2D(values.get('mm2'));
  // Oracle exact : ((A×B)×B).
  const mm = [[1 * 2 + 2 * 0, 1 * 0 + 2 * 2], [3 * 2 + 4 * 0, 3 * 0 + 4 * 2]];
  const exp = [[mm[0][0] * 2 + mm[0][1] * 0, mm[0][0] * 0 + mm[0][1] * 2], [mm[1][0] * 2 + mm[1][1] * 0, mm[1][0] * 0 + mm[1][1] * 2]];
  let worst = 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) worst = Math.max(worst, Math.abs(got[i][j] - exp[i][j]));
  }
  assert.ok(worst < 0.2, `erreur chaîne int8 : ${worst}`);
});

test('exécution : panne injectée + retry, puis échec motivé', async () => {
  const g = chainGraph();
  g.nodes.find((n) => n.id === 'mm').retryMax = 2;
  let calls = 0;
  const { values, metrics } = await executeGraph(g, {
    hooks: { onNode: async (id) => { if (id === 'mm' && ++calls === 1) throw new Error('panne-injectée'); } },
  });
  assert.ok(values.has('out'), 'retry non récupéré');
  assert.equal(calls, 2, `mm aurait dû être tenté 2 fois (panne + retry) : ${calls}`);
  assert.equal(metrics.nodes.mm.attempts, 2, 'tentatives mm non tracées');
  // Panne persistante : échec motivé avec id du nœud.
  await assert.rejects(
    executeGraph(g, { hooks: { onNode: async (id) => { if (id === 'out') throw new Error('panne-dure'); } } }),
    /nœud out en échec/
  );
});

test('planificateur : greedy place tout, arbitre valide/refuse', () => {
  const g = chainGraph();
  const ws = workers2();
  const plan = planGreedy(g, ws);
  assert.equal(plan.v, 1);
  for (const n of g.nodes) assert.ok(plan.assignments[n.id], `nœud ${n.id} non placé`);
  assert.equal(validatePlan(g, plan, ws).ok, true);
  // Plan incompatible : nœud fp32 forcé sur worker sans fp32.
  const rNoFp = buildRegistry({ detectOpts: { benchN: 8 } });
  for (const b of Object.values(rNoFp.backends)) {
    if (b.available) {
      b.dtypes = (b.dtypes || []).filter((d) => d !== 'fp32');
      if (!b.dtypes.length) b.available = false;
    }
  }
  const bad = { v: 1, assignments: Object.fromEntries(g.nodes.map((n) => [n.id, 'wX'])), transfers: [], estMs: 0 };
  assert.equal(validatePlan(g, bad, [{ id: 'wX', registry: rNoFp }]).ok, false);
  // Aucun worker compatible : planification impossible (erreur, pas de plan bancal).
  assert.throws(() => planGreedy(g, [{ id: 'wX', registry: rNoFp }]), /aucun worker compatible/);
});

test('registre : append-only chaîné, altération détectée, relecture JSON', async () => {
  const { Ledger } = require('../src/ledger');
  const S = require('../../nt-pq/src/sigs');
  const id = S.genSigningIdentity();
  const body = (t) => {
    const { receipt, sig } = S.makePqReceipt(id.privateKey, { taskId: t, op: 'matmul', inHash: 'aa', outHash: 'bb', executor: 'e1', durationMs: 1 });
    return { receipt, sig };
  };
  const L = new Ledger();
  L.append('reçu-pq', body('t1'));
  L.append('reçu-pq', body('t2'));
  L.append('faisceau', { finalHash: 'ff', fragments: 2 });
  const verifyEntry = (e) => {
    if (e.kind === 'faisceau') return true;
    return S.verifyPqReceipt(e.body.receipt, e.body.sig, id.publicKey) || 'mauvaise-signature';
  };
  assert.deepEqual(L.verify(verifyEntry), { ok: true, checked: 3 });
  // Relecture JSON : vérifiable hors-ligne (export/import).
  const L2 = Ledger.fromJSON(JSON.parse(JSON.stringify(L.toJSON())));
  assert.deepEqual(L2.verify(verifyEntry), { ok: true, checked: 3 });
  // Altération d'un reçu : détectée à la bonne séquence.
  L2.entries[1].body.receipt.outHash = 'falsifié';
  const bad = L2.verify(verifyEntry);
  assert.equal(bad.ok, false);
  assert.equal(bad.seq, 1);
  assert.match(bad.reason, /empreinte altérée/);
  // Sans vérificateur : seul le chaînage est contrôlé.
  assert.deepEqual(L.verify(), { ok: true, checked: 3 });
});

test('Muse : repli sans clé (2 plans valides), distant mocké arbitré', async () => {
  const g = chainGraph();
  const ws = workers2();
  const input = M.buildFusionInput({ graph: g, workers: ws });
  const fb = await M.proposeFusionPlans(input, g, ws);
  assert.equal(fb.provider, 'heuristic');
  assert.equal(fb.fallbackUsed, true);
  assert.equal(fb.plans.length, 2);
  for (const p of fb.plans) assert.equal(validatePlan(g, p, ws).ok, true);
  // Distant mocké : 1 plan valide + 1 invalide (worker inconnu) → seul le valide survit.
  const goodAssign = Object.fromEntries(g.nodes.map((n) => [n.id, 'w1']));
  const fetchMock = async () => ({
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ plans: [
      { assignments: goodAssign, explanation: 'tout sur w1' },
      { assignments: { ...goodAssign, mm: 'fantome' }, explanation: 'mauvais worker' },
    ] }) } }] }),
  });
  const distant = await M.proposeFusionPlans(input, g, ws, {
    fetchImpl: fetchMock, apiUrl: 'https://mock', apiKey: 'k',
  });
  assert.equal(distant.provider, 'muse');
  assert.equal(distant.plans.length, 1);
  assert.deepEqual(distant.plans[0].assignments, goodAssign);
  // Distant en panne : repli.
  const down = await M.proposeFusionPlans(input, g, ws, {
    fetchImpl: async () => { throw new Error('reseau-coupé'); }, apiUrl: 'https://mock', apiKey: 'k',
  });
  assert.equal(down.fallbackUsed, true);
});

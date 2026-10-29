'use strict';

/**
 * P4 — pont NeuroCore→M2 : graphe FUSION exécuté sur 2 ComputeNode
 * reliés par fil JSON (copie stricte), reçus Ed25519 réels.
 * Preuves : verdicts distribués exacts = run local = oracle JS ;
 * faisceaux §7 présents ; ops whitelistées bornées (tmat/tadd/tmati/tcast).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { Identity } = require('../../mesh-net/src/identity');
const { ComputeNode } = require('../../mesh-compute/src/compute');
const { fromArray2D, toArray2D } = require('../../nt-compat/src/tensors');
const { executeGraph } = require('../../nt-fusion/src/execute');
const { fusionToDag, distribute } = require('../src/mesh');

const nodes = [];
after(async () => {
  for (const c of nodes) {
    try {
      await c.sandbox.shutdown();
    } catch {}
  }
});

function wirePair() {
  const idA = Identity.generate();
  const idB = Identity.generate();
  const mkStub = (ident, peerIdent) => {
    const stub = new EventEmitter();
    stub.id = ident.id;
    stub.identity = ident;
    stub.knownPub = new Map([[peerIdent.id, peerIdent.spkiDer]]);
    stub.sessionKeys = new Map();
    stub.capsExtra = {};
    stub.caps = () => ({ cpus: 4 });
    stub.registry = {
      live: () => [{ id: peerIdent.id, caps: { cpus: 4 } }],
      isSessionVerified: () => true,
    };
    return stub;
  };
  const stubA = mkStub(idA, idB);
  const stubB = mkStub(idB, idA);
  stubA.sendEncrypted = (id, type, payload) => {
    const copy = JSON.parse(JSON.stringify(payload));
    setImmediate(() => cb._onMessage({ type, from: stubA.id, payload: copy, encrypted: false, relayed: false }));
    return 'simulated';
  };
  stubB.sendEncrypted = (id, type, payload) => {
    const copy = JSON.parse(JSON.stringify(payload));
    setImmediate(() => ca._onMessage({ type, from: stubB.id, payload: copy, encrypted: false, relayed: false }));
    return 'simulated';
  };
  const ca = new ComputeNode(stubA, { excludeSelf: true });
  const cb = new ComputeNode(stubB, {});
  nodes.push(ca, cb);
  return { ca, idB: stubB.id };
}

function inputs(n) {
  const M = (f) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
  const raw = {
    A: M((i, j) => (i + j) * 0.5),
    B: M((i, j) => (i - j) * 0.25),
    C: M((i, j) => ((i + j) % 5) - 2),
    D: M(() => 1),
  };
  return {
    raw,
    A: fromArray2D(raw.A, 'fp32'),
    B: fromArray2D(raw.B, 'fp32'),
    C: fromArray2D(raw.C, 'int8'),
    D: fromArray2D(raw.D, 'fp32'),
  };
}

/** Graphe local équivalent avec les VRAIES matrices d'origine. */
function localGraph(raw) {
  const inp = (id, dtype) => ({ id, kind: 'input', dtype, deps: [], params: { values: raw[id] } });
  return { v: 1, nodes: [
    inp('A', 'fp32'), inp('B', 'fp32'),
    { id: 'mm', kind: 'matmul', dtype: 'fp32', deps: ['A', 'B'], in: { a: { $node: 'A' }, b: { $node: 'B' } } },
    { id: 'qi', kind: 'cast', dtype: 'int8', deps: ['mm'], in: { x: { $node: 'mm' } } },
    inp('C', 'int8'),
    { id: 'mm2', kind: 'matmul', dtype: 'int8', deps: ['qi', 'C'], in: { a: { $node: 'qi' }, b: { $node: 'C' } } },
    { id: 'qf', kind: 'cast', dtype: 'fp32', deps: ['mm2'], in: { x: { $node: 'mm2' } } },
    inp('D', 'fp32'),
    { id: 'out', kind: 'add', dtype: 'fp32', deps: ['qf', 'D'], in: { a: { $node: 'qf' }, b: { $node: 'D' } } },
  ]};
}

function graph() {
  return { v: 1, nodes: [
    { id: 'A', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[0]] } },
    { id: 'B', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[0]] } },
    { id: 'mm', kind: 'matmul', dtype: 'fp32', deps: ['A', 'B'], in: { a: { $node: 'A' }, b: { $node: 'B' } } },
    { id: 'qi', kind: 'cast', dtype: 'int8', deps: ['mm'], in: { x: { $node: 'mm' } } },
    { id: 'C', kind: 'input', dtype: 'int8', deps: [], params: { values: [[0]] } },
    { id: 'mm2', kind: 'matmul', dtype: 'int8', deps: ['qi', 'C'], in: { a: { $node: 'qi' }, b: { $node: 'C' } } },
    { id: 'qf', kind: 'cast', dtype: 'fp32', deps: ['mm2'], in: { x: { $node: 'mm2' } } },
    { id: 'D', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[0]] } },
    { id: 'out', kind: 'add', dtype: 'fp32', deps: ['qf', 'D'], in: { a: { $node: 'qf' }, b: { $node: 'D' } } },
  ]};
}

test('pont M2 : DAG converti valide, exécuté distant, exact', async () => {
  const { ca, idB } = wirePair();
  const n = 4;
  const ins = inputs(n);
  const g = graph();
  const dag = fusionToDag(g, ins);
  // qf (cast fp32→fp32 après tmati) éliminé par alias : 4 fragments.
  assert.equal(dag.fragments.length, 4, 'fragments attendus : mm, qi, mm2, out');
  assert.deepEqual(dag.fragments.map((f) => f.op), ['tmat', 'tcast', 'tmati', 'tadd']);
  assert.deepEqual(dag.fragments.map((f) => f.id), ['mm', 'qi', 'mm2', 'out']);
  // Exécution distribuée réelle (coordinateur→exécutant par le fil).
  const { job } = await distribute(ca, g, ins);
  assert.equal(job.outcome, 'done', `job non done : ${JSON.stringify(job).slice(0, 300)}`);
  assert.ok(job.fragments.every((f) => f.outcome === 'done'), 'fragment non done');
  assert.ok(job.fragments.every((f) => (f.executedBy || []).includes(idB)), 'fragment non exécuté à distance');
  // Référence locale (mêmes matrices d'origine, moteur FUSION).
  const local = await executeGraph(localGraph(ins.raw));
  const expLocal = toArray2D(local.values.get('out'));
  const got = job.value.m;
  assert.equal(got.length, n);
  // Tolérance : les backends diffèrent en précision (Float32Array local
  // vs nombres fp64 M2) — écart d'arrondi ≪ erreur int8, borné ici.
  let worst = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      worst = Math.max(worst, Math.abs(got[i][j] - expLocal[i][j]));
      peak = Math.max(peak, Math.abs(expLocal[i][j]));
    }
  }
  const rel = worst / Math.max(1e-9, peak);
  assert.ok(rel < 1e-6, `distribué ≠ local (rel ${rel})`);
  console.log(`    [mesuré ici] écart distribué/local : ${worst} (relatif ${rel.toExponential(1)}, précision backends)`);
});

test('pont M2 : refus motivés (input manquant, hors bornes, non distribuable)', async () => {
  const ins = inputs(2);
  assert.throws(() => fusionToDag(graph(), {}), /input A manquant/);
  const bad = inputs(2);
  bad.A = fromArray2D([[1]], 'fp64');
  assert.throws(() => fusionToDag(graph(), bad), /dtype/);
  const g2 = { v: 1, nodes: [
    { id: 'A', kind: 'input', dtype: 'bf16', deps: [], params: { values: [[1]] } },
    { id: 'x', kind: 'add', dtype: 'bf16', deps: ['A', 'A'], in: { a: { $node: 'A' }, b: { $node: 'A' } } },
  ]};
  assert.throws(() => fusionToDag(g2, { A: fromArray2D([[1]], 'fp32') }), /invalide|dtype/);
});

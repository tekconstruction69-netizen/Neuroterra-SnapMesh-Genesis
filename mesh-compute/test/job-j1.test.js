'use strict';

/**
 * M5 — régression du test local réel (job j1 batch-fib [20,25,30]).
 * Contexte : M5-TEST-LOCAL.ps1 hors sandbox a produit "aucune ligne [job]"
 * (coordinateur mort avant le verdict). Ce test rejoue EN PROCESSUS la
 * charge EXACTE construite par le CLI --job (buildBatchFib(params.ns,
 * params)) sur coordinateur (excludeSelf) + 1 worker reliés par fil JSON
 * (copie stricte) : il prouve que le DAG, la soumission distante et le
 * verdict sont valides indépendamment des sockets/CLI. Si ce test passe
 * mais que le terrain échoue, la cause est dans la couche réelle
 * (sockets/CLI/lancement) — voir le diagnostic de Run-Job.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { Identity } = require('../../mesh-net/src/identity');
const { ComputeNode } = require('../src/compute');
const { buildBatchFib } = require('../src/fragments');

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

test('M5-j1 : batch-fib [20,25,30] construit comme le CLI, exécuté distant, exact', async () => {
  const { ca, idB } = wirePair();
  // Construction IDENTIQUE à compute-node.js --job batch-fib
  // --job-params '{"ns":[20,25,30]}' : presetArgs = [params.ns, params].
  const params = JSON.parse('{"ns":[20,25,30]}');
  const dag = buildBatchFib(params.ns, params);
  assert.equal(dag.fragments.length, 3);
  assert.deepEqual(dag.fragments.map((f) => f.op), ['fib', 'fib', 'fib']);
  const job = await ca.submitDag(dag);
  assert.equal(job.outcome, 'done', `job non done : ${JSON.stringify(job).slice(0, 300)}`);
  assert.ok(job.fragments.every((f) => f.outcome === 'done'), 'fragment non done');
  assert.ok(job.fragments.every((f) => (f.executedBy || []).includes(idB)), 'fragment non exécuté à distance');
  assert.deepEqual(job.value, [6765, 75025, 832040], 'valeurs batch-fib inexactes');
  console.log('    [mesuré ici] j1 en-process : done, distant, [6765,75025,832040]');
});

test('M5-j1 : job-params malformé rejeté avec erreur explicite (pas de pendaison)', () => {
  assert.throws(() => JSON.parse('{"ns":['), SyntaxError);
  assert.throws(() => buildBatchFib(undefined, {}), /ns non vide/);
  assert.throws(() => buildBatchFib([], {}), /ns non vide/);
});

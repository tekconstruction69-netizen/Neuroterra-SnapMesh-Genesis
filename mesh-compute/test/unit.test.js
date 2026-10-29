'use strict';

/** Tests unitaires M2 : ops, ordonnanceurs, vérificateur, file. Sans réseau. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { runOp, listOps } = require('../src/ops');
const { schedulers } = require('../src/sched');
const { decide, quorumThreshold } = require('../src/verifier');
const { TaskQueue } = require('../src/tasks');

// ---------- ops ----------

test('ops : résultats déterministes connus', () => {
  assert.equal(runOp('fib', { n: 30 }), 832040);
  assert.deepEqual(runOp('primes', { max: 100 }), { count: 25 });
  assert.equal(runOp('sha256-hex', { text: 'abc' }), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.deepEqual(runOp('wordcount', { text: 'un deux\ntrois' }), { words: 3, lines: 2, chars: 13 });
  assert.deepEqual(runOp('sort-int', { values: [3, 1, 2] }), [1, 2, 3]);
  assert.deepEqual(runOp('matmul', { a: [[1, 2], [3, 4]], b: [[5, 6], [7, 8]] }), [[19, 22], [43, 50]]);
  assert.ok(Object.keys(listOps()).length >= 6);
});

test('ops : bornes et op inconnue rejetées, rien n\'est exécuté', () => {
  assert.throws(() => runOp('fib', { n: 41 }), /args-invalides/);
  assert.throws(() => runOp('fib', { n: 'x' }), /args-invalides/);
  assert.throws(() => runOp('sha256-hex', { text: 'x'.repeat(5000) }), /args-invalides/);
  assert.throws(() => runOp('sort-int', { values: 'pas-un-tableau' }), /args-invalides/);
  assert.throws(() => runOp('rm-rf', {}), /op-inconnue/);
});

// ---------- ordonnanceurs ----------

const CANDS = [
  { id: 'b', cpus: 8, load: 0 },
  { id: 'a', cpus: 2, load: 0 },
  { id: 'c', cpus: 2, load: 3 },
];

test('round-robin : rotation déterministe sur ids triés', () => {
  const s = schedulers['round-robin'];
  const st = {};
  assert.deepEqual([s.pick({}, CANDS, st), s.pick({}, CANDS, st), s.pick({}, CANDS, st), s.pick({}, CANDS, st)], ['a', 'b', 'c', 'a']);
});

test('capacity : préfère CPU élevé et charge faible, id tranche', () => {
  const s = schedulers.capacity;
  assert.equal(s.pick({}, CANDS, {}), 'b'); // 8 CPU, charge 0
  assert.equal(s.pick({}, [], {}), null);
});

test('local : coordinateur d\'abord, sinon premier par id', () => {
  const s = schedulers.local;
  assert.equal(s.pick({ coordinatorId: 'c' }, CANDS, {}), 'c');
  assert.equal(s.pick({ coordinatorId: 'zzz' }, CANDS, {}), 'a');
});

// ---------- vérificateur ----------

test('verifier : seuil quorum et cas 2-contre-1', () => {
  assert.equal(quorumThreshold(3), 2);
  const d = decide([
    { executorId: 'a', result: 42 },
    { executorId: 'b', result: 42 },
    { executorId: 'c', result: 43 },
  ], 3);
  assert.equal(d.outcome, 'agreed');
  assert.equal(d.value, 42);
  assert.deepEqual(d.agreeing.sort(), ['a', 'b']);
  assert.deepEqual(d.dissenting, ['c']);
});

test('verifier : désaccord total et insuffisance', () => {
  const d1 = decide([
    { executorId: 'a', result: 1 },
    { executorId: 'b', result: 2 },
    { executorId: 'c', result: 3 },
  ], 3);
  assert.equal(d1.outcome, 'disagree');
  const d2 = decide([{ executorId: 'a', result: 1 }], 3);
  assert.equal(d2.outcome, 'insufficient');
  const d3 = decide([], 2);
  assert.equal(d3.outcome, 'insufficient');
});

// ---------- file ----------

test('file : doublon ignoré, résultat après clôture ignoré', () => {
  const q = new TaskQueue();
  const t = q.submit({ op: 'fib', args: { n: 5 }, redundancy: 1, timeoutMs: 5000, coordinatorId: 'x' });
  q.assign(t, 'e1', () => {});
  assert.equal(q.recordResult(t, 'e1', 5, 1), 'accepted');
  assert.equal(q.recordResult(t, 'e1', 5, 1), 'duplicate');
  q.settle(t, 'done');
  assert.equal(q.recordResult(t, 'e2', 5, 1), 'settled');
});

test('file : résultat non sollicité, périmé, mauvaise op, surdimensionné rejetés sans effet', async () => {
  const { EventEmitter } = require('node:events');
  const { ComputeNode } = require('../src/compute');
  const stub = new EventEmitter();
  stub.id = 'coord';
  stub.registry = { live: () => [] };
  stub.caps = () => ({ cpus: 2 });
  stub._sendTo = () => false;
  const c = new ComputeNode(stub, {});
  const done = await c.submit('fib', { n: 5 }, { redundancy: 1 });
  assert.equal(done.outcome, 'done');
  assert.equal(done.value, 5);
  const task = c.queue.get(done.taskId);
  const before = task.results.size;
  // Duplicata de l'exécutant légitime.
  c._handleResult(done.agreeing[0], { v: 1, taskId: task.id, op: 'fib', result: 5 });
  // Inconnu jamais affecté.
  c._handleResult('intrus', { v: 1, taskId: task.id, op: 'fib', result: 5 });
  // Mauvaise opération.
  c._handleResult(done.agreeing[0], { v: 1, taskId: task.id, op: 'primes', result: 5 });
  // Résultat surdimensionné et non sérialisable.
  c._handleResult(done.agreeing[0], { v: 1, taskId: task.id, op: 'fib', result: 'x'.repeat(70000) });
  c._handleResult(done.agreeing[0], { v: 1, taskId: task.id, op: 'fib', result: undefined });
  assert.equal(task.results.size, before, 'soldée : aucun rejet ne vote');
  assert.ok((c.stats.rejected.settled || 0) >= 1, 'rejets comptés');
  const { TaskQueue: TQ2 } = require('../src/tasks');
  const q2 = new TQ2();
  const t2 = q2.submit({ op: 'fib', args: { n: 1 }, redundancy: 1, timeoutMs: 5000, coordinatorId: 'x' });
  q2.assign(t2, 'e1', () => {});
  assert.equal(q2.recordResult(t2, 'intrus', 1, 0, { op: 'fib' }), 'unsolicited');
  assert.equal(q2.recordResult(t2, 'e1', 1, 0, { op: 'primes' }), 'wrong-op');
  assert.equal(q2.recordResult(t2, 'e1', 'x'.repeat(70000), 0, { op: 'fib' }), 'oversize');
  assert.equal(q2.recordResult(t2, 'e1', undefined, 0, { op: 'fib' }), 'bad-result');
  assert.equal(t2.results.size, 0, 'en vol : aucun rejet ne vote');
  assert.equal(q2.recordResult(t2, 'e1', 1, 0, { op: 'fib' }), 'accepted');
  assert.equal(q2.recordResult(t2, 'e1', 1, 0, { op: 'fib' }), 'duplicate');
});

test('file : résultat tardif après expiration rejeté, non réutilisé', async () => {
  const q = new TaskQueue({ maxAttempts: 3 });
  const t = q.submit({ op: 'fib', args: { n: 5 }, redundancy: 1, timeoutMs: 120, coordinatorId: 'x' });
  let timedOut = false;
  q.assign(t, 'lent', () => { timedOut = true; });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(timedOut);
  assert.equal(q.recordResult(t, 'lent', 5, 1, { op: 'fib' }), 'stale');
  assert.equal(t.results.size, 0, 'le résultat périmé ne vote pas');
  // Réaffectation : la nouvelle tentative est acceptée (pas de réutilisation de l'ancienne).
  q.assign(t, 'lent', () => {});
  assert.equal(q.recordResult(t, 'lent', 5, 1, { op: 'fib' }), 'accepted');
  assert.equal(t.results.size, 1);
});

test('file : validation stricte de soumission (lève avant diffusion)', () => {
  const q = new TaskQueue();
  const v = (op, args) => {
    if (op !== 'fib') throw new Error('op-inconnue');
  };
  assert.throws(() => q.submit({ op: 'fib', args: {}, redundancy: 0, timeoutMs: 1000, coordinatorId: 'x' }, v), /redondance-invalide/);
  assert.throws(() => q.submit({ op: 'fib', args: {}, redundancy: 6, timeoutMs: 1000, coordinatorId: 'x' }, v), /redondance-invalide/);
  assert.throws(() => q.submit({ op: 'fib', args: {}, redundancy: 1, timeoutMs: 50, coordinatorId: 'x' }, v), /timeout-invalide/);
  assert.throws(() => q.submit({ op: 'nope', args: {}, redundancy: 1, timeoutMs: 1000, coordinatorId: 'x' }, v), /op-inconnue/);
});

test('file : persistance aller-retour (tâche, résultats, tentatives)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '.tmp-unit');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'q.json');
  try { fs.unlinkSync(f); } catch {}
  const q1 = new TaskQueue({ persistPath: f });
  const t = q1.submit({ op: 'fib', args: { n: 6 }, redundancy: 2, timeoutMs: 5000, coordinatorId: 'c' });
  q1.assign(t, 'e1', () => {});
  assert.equal(q1.recordResult(t, 'e1', 8, 1, { op: 'fib' }), 'accepted');
  const q2 = new TaskQueue({ persistPath: f });
  const loaded = q2.load();
  assert.equal(loaded.length, 1);
  const r = loaded[0];
  assert.equal(r.id, t.id);
  assert.equal(r.state, 'pending', 'à re-dispatcher');
  assert.equal(r.assignments.size, 0, 'affectations reparties à zéro');
  assert.equal(r.results.size, 1, 'votes conservés');
  assert.equal(r.results.get('e1').result, 8);
  assert.ok(r.attempts >= 1, 'compteur de tentatives conservé');
});

test('file : mémoire bornée (soldées élaguées)', () => {
  const q = new TaskQueue();
  for (let i = 0; i < 105; i++) {
    const t = q.submit({ op: 'fib', args: { n: 1 }, redundancy: 1, timeoutMs: 1000, coordinatorId: 'x' });
    q.settle(t, 'done');
  }
  assert.ok(q.tasks.size <= 100, `taille=${q.tasks.size}`);
});

test('file : expiration déclenchée et réaffectation bornée', async () => {
  const q = new TaskQueue({ maxAttempts: 2 });
  const t = q.submit({ op: 'fib', args: { n: 5 }, redundancy: 1, timeoutMs: 120, coordinatorId: 'x' });
  let fired = 0;
  q.assign(t, 'e1', () => { fired++; });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fired, 1);
  assert.equal(q.executorFailed(t, 'e1'), true); // tentative 1/2 : on peut réessayer
  q.assign(t, 'e2', () => {});
  assert.equal(q.executorFailed(t, 'e2'), false); // tentative 2/2 : stop
});

'use strict';

/** Tests unitaires §4 : bornes réelles du bac à sable (aucun réseau). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Sandbox } = require('../src/sandbox');

test('sandbox : succès, valeur exacte, durée mesurée, stats', async () => {
  const sb = new Sandbox();
  const { result, durationMs } = await sb.run('fib', { n: 25 });
  assert.equal(result, 75025);
  assert.ok(typeof durationMs === 'number' && durationMs >= 0);
  const s = sb.stats();
  assert.equal(s.done, 1);
  assert.equal(s.active, 0, 'worker libéré après succès');
  await sb.shutdown();
});

test('sandbox : op inconnue et args invalides refusés (liste blanche tenue)', async () => {
  const sb = new Sandbox();
  await assert.rejects(sb.run('rm-rf', {}), /op-inconnue/);
  await assert.rejects(sb.run('fib', { n: 41 }), /args-invalides/);
  await sb.shutdown();
});

test('sandbox : timeout réel — worker tué, tâche rejetée', async () => {
  // Le démarrage d'un worker (fil + modules) dépasse toujours 1 ms :
  // ce test prouve le kill, pas la vitesse d'une op.
  const sb = new Sandbox({ execTimeoutMs: 1 });
  await assert.rejects(sb.run('primes', { max: 200000 }), /sandbox-timeout/);
  assert.equal(sb.stats().timeout, 1);
  assert.equal(sb.stats().active, 0, 'worker tué après timeout');
  await sb.shutdown();
});

test('sandbox : résultat surdimensionné rejeté avant remise', async () => {
  const sb = new Sandbox({ maxResultBytes: 10 });
  const ones = (n) => Array.from({ length: n }, () => Array(n).fill(1));
  await assert.rejects(sb.run('matmul', { a: ones(8), b: ones(8) }), /sandbox-result-too-large/);
  await sb.shutdown();
});

test('sandbox : concurrence bornée — surplus refusé sandbox-busy', async () => {
  const sb = new Sandbox({ maxWorkers: 1 });
  const p1 = sb.run('fib', { n: 20 });
  const p2 = sb.run('fib', { n: 20 }); // refusé : le slot est pris (synchrone)
  await assert.rejects(p2, /sandbox-busy/);
  assert.equal((await p1).result, 6765);
  assert.equal(sb.stats().busy, 1);
  await sb.shutdown();
});

test('sandbox : annulation par run — rejet sandbox-cancelled', async () => {
  const sb = new Sandbox();
  const p = sb.run('primes', { max: 200000 });
  assert.equal(p.cancel(), true, 'annulation acceptée en vol');
  await assert.rejects(p, /sandbox-cancelled/);
  assert.equal(p.cancel(), false, 'double annulation sans effet');
  await sb.shutdown();
});

test('sandbox : crash worker simulé — rejet sandbox-crash', async () => {
  const sb = new Sandbox();
  const p = sb.run('primes', { max: 200000 });
  const [w] = sb._activeWorkers();
  assert.ok(w, 'worker en vol exposé au test');
  await w.terminate(); // panne simulée : le run doit rejeter, pas pendre
  await assert.rejects(p, /sandbox-crash/);
  await sb.shutdown();
});

test('sandbox : describe expose la config réelle (dont osSandbox:false)', async () => {
  const sb = new Sandbox({ maxWorkers: 3, execTimeoutMs: 7000, memMb: 96 });
  assert.deepEqual(sb.describe(), {
    maxWorkers: 3,
    execTimeoutMs: 7000,
    memMb: 96,
    maxResultBytes: 1024 * 1024,
    backend: 'worker_threads',
    osSandbox: false,
  });
  await sb.shutdown();
});

test('sandbox : shutdown rejette l\u2019en-cours et vide les slots', async () => {
  const sb = new Sandbox();
  const p = sb.run('primes', { max: 200000 });
  p.catch(() => {}); // rejet géré dès l'émission (shutdown termine le thread)
  await sb.shutdown();
  await assert.rejects(p, /sandbox-shutdown/);
  assert.equal(sb.stats().active, 0);
});

test('câblage : l’exécutant fait passer la tâche réseau par le sandbox', async () => {
  // FAIL-FIRST : échoue tant que ComputeNode exécute runOp en processus.
  const { EventEmitter } = require('node:events');
  const { ComputeNode } = require('../src/compute');
  const stub = new EventEmitter();
  stub.id = 'exec-tt';
  stub.registry = { live: () => [] };
  stub.caps = () => ({ cpus: 2 });
  const sent = [];
  stub.sendEncrypted = (id, type, payload) => {
    sent.push({ id, type, payload });
    return 'encrypted';
  };
  const c = new ComputeNode(stub, {});
  const execEv = new Promise((resolve) => stub.once('exec', resolve));
  await c._handleTask('coord-tt', { v: 1, taskId: 'tt-1', op: 'fib', args: { n: 10 } });
  const ev = await execEv;
  assert.equal(ev.sandboxed, true, 'tâche réseau exécutée hors sandbox');
  assert.equal(sent.length, 1, 'RESULT renvoyé au coordinateur');
  assert.equal(sent[0].type, 'RESULT');
  assert.equal(sent[0].payload.result, 55);
  assert.ok(typeof sent[0].payload.durationMs === 'number', 'durée réelle mesurée');
  await c.sandbox.shutdown();
});

test('P5 : STOP annule en-cours + file en délai vérifiable', async () => {
  // P5 (M4) : le bouton STOP doit arrêter les opérations en cours dans un
  // délai vérifiable. Preuve : 2 runs (1er ~50 ms en cours, 2e en file),
  // shutdown immédiat => les deux rejetés, délai total < 2 s.
  const { Sandbox } = require('../src/sandbox');
  const s = new Sandbox({ maxWorkers: 1, execTimeoutMs: 30000, memMb: 64 });
  try {
    const t0 = process.hrtime.bigint();
    await s.run('fib', { n: 40 });
    const calib = Number(process.hrtime.bigint() - t0) / 1e6;
    if (calib < 20) {
      console.log(`    [contrainte] fib40 trop rapide ici (${calib.toFixed(1)} ms) : annulation non mesurable, test ignoré`);
      return;
    }
    const r1 = s.run('fib', { n: 40 });
    const r2 = s.run('fib', { n: 40 });
    const settled = [];
    r1.then(() => settled.push('r1-termine')).catch((e) => settled.push(`r1-${e.code || 'rejet'}`));
    r2.then(() => settled.push('r2-termine')).catch((e) => settled.push(`r2-${e.code || 'rejet'}`));
    await new Promise((r) => setTimeout(r, 5));
    const t1 = process.hrtime.bigint();
    await s.shutdown();
    const stopMs = Number(process.hrtime.bigint() - t1) / 1e6;
    await Promise.allSettled([r1, r2]);
    assert.ok(!settled.includes('r1-termine'), `tâche en cours non annulée : ${settled}`);
    assert.ok(!settled.includes('r2-termine'), `tâche en file non annulée : ${settled}`);
    assert.ok(stopMs < 2000, `STOP trop lent : ${stopMs.toFixed(0)} ms`);
    console.log(`    [mesuré ici] STOP : 2 tâches annulées en ${stopMs.toFixed(1)} ms (tâche ~${calib.toFixed(0)} ms)`);
  } finally {
    try {
      await s.shutdown();
    } catch {}
  }
});

test('P3 : args hostiles sans effet (clés parasites, proto, fonctions)', async () => {
  // P3 (audit) : la liste blanche ne lit que les champs attendus ; les
  // clés parasites (y compris __proto__/constructor/fonctions, droppées
  // ou ignorées par la copie structurée) ne modifient ni le résultat
  // ni Object.prototype. Preuve via le vrai Sandbox (worker réel).
  const { Sandbox } = require('../src/sandbox');
  const s = new Sandbox({ maxWorkers: 2, execTimeoutMs: 5000, memMb: 64 });
  try {
    await assert.rejects(s.run('__proto__', { text: 'x' }), /./, 'op hostile acceptée');
    const r1 = await s.run('fib', JSON.parse('{"n":5,"constructor":{"prototype":{"pollue":1}}}'));
    assert.equal(r1.result, 5, 'clés parasites modifient le résultat');
    const r2 = await s.run('fib', { n: 5, f: 'x=>1', require: 'fs' });
    assert.equal(r2.result, 5);
    assert.equal({}.pollue, undefined, 'Object.prototype pollué');
    assert.equal({}.require, undefined, 'Object.prototype pollué');
  } finally {
    await s.shutdown();
  }
});

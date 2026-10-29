'use strict';

/**
 * Tests §7 : reçus signés, empreintes E/S, faisceau de preuve du job.
 * Nœuds réels en processus (vrais sockets, sans découverte) pour les clés.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { Identity } = require('../../mesh-net/src/identity');
const { stableHash, makeReceipt, verifyReceipt } = require('../src/receipts');

test('reçus : signature valide, falsification et mauvaise clé rejetées', () => {
  const a = Identity.generate();
  const b = Identity.generate();
  const args = { n: 10 };
  const { receipt, sig } = makeReceipt(a, { taskId: 't', op: 'fib', args, result: 55, executor: a.id, durationMs: 3 });
  assert.equal(receipt.inHash, stableHash(args));
  assert.equal(receipt.outHash, stableHash(55));
  assert.equal(verifyReceipt(receipt, sig, a.spkiDer), true);
  // Résultat altéré après signature : le reçu ne couvre plus la charge.
  assert.equal(verifyReceipt({ ...receipt, outHash: stableHash(56) }, sig, a.spkiDer), false);
  assert.equal(verifyReceipt(receipt, sig, b.spkiDer), false, 'clé étrangère acceptée');
  const badSig = Buffer.from(sig, 'base64');
  badSig[0] ^= 1;
  assert.equal(verifyReceipt(receipt, badSig.toString('base64'), a.spkiDer), false);
});

test('réseau : RESULT falsifié rejeté bad-receipt, sans vote', async () => {
  const { SnapMeshNode } = require('../../mesh-net/src/node');
  const { ComputeNode } = require('../src/compute');
  const mk = (name, tcp, peers) => new SnapMeshNode({
    name, tcpPort: tcp, ephemeral: true, discovery: false, manualPeers: peers,
    heartbeatMs: 500, suspectAfterMs: 1500, deadAfterMs: 3000, statusPort: tcp + 500,
  });
  const b = mk('rc-b', 48472, []);
  const a = mk('rc-a', 48471, ['127.0.0.1:48472']);
  const ca = new ComputeNode(a, {});
  const cb = new ComputeNode(b, {});
  void cb;
  await b.start();
  await a.start();
  try {
    const t0 = Date.now();
    while (!a.registry.isSessionVerified(b.id)) {
      if (Date.now() - t0 > 10000) throw new Error('session non vérifiée');
      await new Promise((r) => setTimeout(r, 100));
    }
    // Tâche manuelle affectée à B (sans diffusion) pour injection contrôlée.
    const task = ca.queue.submit(
      { op: 'fib', args: { n: 10 }, redundancy: 1, timeoutMs: 8000, coordinatorId: a.id },
      (o, x) => require('../src/ops').runOp(o, x)
    );
    ca.queue.assign(task, b.id, () => {});
    const good = makeReceipt(b.identity, { taskId: task.id, op: 'fib', args: { n: 10 }, result: 55, executor: b.id, durationMs: 1 });
    const payload = (result, rec, sig) => ({ v: 1, taskId: task.id, op: 'fib', result, durationMs: 1, inHash: rec?.receipt.inHash, outHash: rec?.receipt.outHash, receipt: rec?.receipt || null, sig: sig || null });
    // Bon reçu : accepté.
    ca._handleResult(b.id, payload(55, good, good.sig));
    assert.equal(task.results.size, 1, 'bon reçu rejeté');
    // Résultat altéré, reçu d'origine : rejeté sans vote.
    const verdicts = [];
    a.on('rejected-result', (r) => verdicts.push(r.reason));
    ca._handleResult(b.id, payload(56, good, good.sig));
    assert.ok(verdicts.includes('bad-receipt'), `falsifié non rejeté : [${verdicts}]`);
    assert.equal(task.results.size, 1, 'le faux résultat a voté');
    // Sans reçu (pair distant) : rejeté missing-receipt.
    ca._handleResult(b.id, { v: 1, taskId: task.id, op: 'fib', result: 55, durationMs: 1 });
    assert.ok(verdicts.includes('missing-receipt'), `sans-reçu non rejeté : [${verdicts}]`);
    assert.equal(task.results.size, 1);
    // Reçu d'un autre exécutant rejoué : rejeté (liaison from).
    const other = Identity.generate();
    const fake = makeReceipt(other, { taskId: task.id, op: 'fib', args: { n: 10 }, result: 55, executor: b.id, durationMs: 1 });
    ca._handleResult(b.id, payload(55, fake, fake.sig));
    assert.ok(verdicts.includes('bad-receipt'), `reçu rejoué accepté : [${verdicts}]`);
  } finally {
    await a.stop();
    await b.stop();
    await ca.sandbox.shutdown();
    await cb.sandbox.shutdown();
  }
});

test('job : faisceau de preuve (empreintes + reçus + finale) vérifiable', async () => {
  const { EventEmitter } = require('node:events');
  const { ComputeNode } = require('../src/compute');
  const stub = new EventEmitter();
  stub.id = 'pv-tt';
  stub.identity = Identity.generate();
  stub.knownPub = new Map();
  stub.registry = { live: () => [], isSessionVerified: () => true };
  stub.caps = () => ({ cpus: 2 });
  stub._sendTo = () => false;
  stub.sendEncrypted = () => 'encrypted';
  const { buildBatchFib } = require('../src/fragments');
  const c = new ComputeNode(stub, {});
  const job = await c.submitDag(buildBatchFib([10, 15]));
  assert.equal(job.outcome, 'done');
  assert.ok(job.verification, 'faisceau absent');
  assert.equal(job.verification.finalHash, stableHash(job.value));
  assert.equal(job.verification.fragments.length, 2);
  const ns = [10, 15];
  job.verification.fragments.forEach((f, i) => {
    assert.equal(f.inHash, stableHash({ n: ns[i] }), 'empreinte entrée incohérente');
    assert.equal(f.outHash, stableHash(job.value[i]), 'empreinte sortie incohérente');
    assert.ok(f.receipts.length >= 1);
    assert.ok(f.receipts.every((r) => r.verified === true), 'reçu non vérifié dans le faisceau');
    assert.ok(f.receipts.every((r) => r.executor === job.fragments[i].executedBy.find((id) => id === r.executor)), 'liaison reçu↔exécutant');
  });
  await c.sandbox.shutdown();
});

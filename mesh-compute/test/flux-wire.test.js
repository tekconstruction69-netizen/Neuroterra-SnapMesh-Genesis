'use strict';

/**
 * NT-Flux : boucle complète coordinateur ↔ exécutant SANS sockets
 * (le sandbox interdit `listen`, et les tests spawn meurent EACCES ici).
 * Le "fil" est une sérialisation JSON réelle (stringify/parse) : les
 * enveloppes `flux`/`ref`/`dedupAck` prouvent leur traversée réseau.
 * Les reçus §7 sont réels (Identity Ed25519 + knownPub croisés).
 * Le vrai 2-processus TCP est couvert par `flux-e2e.test.js`
 * (à exécuter dans un PowerShell ordinaire, hors sandbox).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { Identity } = require('../../mesh-net/src/identity');
const { ComputeNode } = require('../src/compute');

const nodes = [];
after(async () => {
  for (const c of nodes) {
    try {
      await c.sandbox.shutdown();
    } catch {}
  }
});

/** Deux ComputeNode reliés par un fil JSON (copie profonde stricte). */
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
      live: () => [{ id: peerIdent.id, caps: { cpus: 4, flux: { codecs: ['raw', 'deflate', 'gzip', 'brotli'] } } }],
      isSessionVerified: () => true,
    };
    return stub;
  };
  const stubA = mkStub(idA, idB);
  const stubB = mkStub(idB, idA);
  const statsA = [];
  const statsB = [];
  stubA.on('flux-stats', (s) => statsA.push(s));
  stubB.on('flux-stats', (s) => statsB.push(s));
  // Fil réseau simulé : copie JSON stricte (échoue sur non-sérialisable).
  stubA.sendEncrypted = (id, type, payload) => {
    assert.equal(id, stubB.id);
    const copy = JSON.parse(JSON.stringify(payload));
    setImmediate(() => cb._onMessage({ type, from: stubA.id, payload: copy, encrypted: false, relayed: false }));
    return 'simulated';
  };
  stubB.sendEncrypted = (id, type, payload) => {
    assert.equal(id, stubA.id);
    const copy = JSON.parse(JSON.stringify(payload));
    setImmediate(() => ca._onMessage({ type, from: stubB.id, payload: copy, encrypted: false, relayed: false }));
    return 'simulated';
  };
  const ca = new ComputeNode(stubA, { flux: { enabled: true, effort: 'normal' }, excludeSelf: true });
  const cb = new ComputeNode(stubB, { flux: { enabled: true, effort: 'normal' } });
  nodes.push(ca, cb);
  return { ca, cb, stubA, stubB, statsA, statsB, idB: stubB.id };
}

test('fil flux : pleine compressée puis ref 64 o, verdicts exacts distants', async () => {
  const { ca, statsA, statsB, idB } = wirePair();
  const text = 'ligne de texte compressible pour NT-Flux 0123456789\n'.repeat(1000);
  assert.ok(text.length > 2048 && text.length <= 64 * 1024, `taille texte: ${text.length}`);
  const oracle = {
    words: (text.match(/\S+/g) || []).length,
    lines: text.split('\n').length,
    chars: text.length,
  };
  const r1 = await ca.submit('wordcount', { text }, { redundancy: 1, timeoutMs: 15000 });
  assert.equal(r1.outcome, 'done', JSON.stringify(r1).slice(0, 300));
  assert.deepEqual(r1.value, oracle);
  assert.deepEqual(r1.agreeing, [idB], '1re tâche non exécutée à distance');
  const r2 = await ca.submit('wordcount', { text }, { redundancy: 1, timeoutMs: 15000 });
  assert.equal(r2.outcome, 'done', JSON.stringify(r2).slice(0, 300));
  assert.deepEqual(r2.value, oracle);
  assert.deepEqual(r2.agreeing, [idB], '2e tâche non exécutée à distance');
  // Fil prouvé : envoi 1 = flux compressé (gain réel), envoi 2 = ref 64 o.
  const sends = statsA.filter((s) => s.dir === 'send');
  assert.equal(sends.length, 2, JSON.stringify(sends));
  assert.equal(sends[0].kind, 'flux', `1er envoi: ${sends[0].kind}`);
  assert.ok(sends[0].outBytes < sends[0].inBytes, 'aucun gain de compression mesuré');
  assert.equal(sends[1].kind, 'ref', `2e envoi: ${sends[1].kind}`);
  assert.equal(sends[1].outBytes, 64, 'ref non 64 octets');
  // Réception miroir : flux puis ref ; accusé dedup enregistré (fluxKnown).
  const recvs = statsB.filter((s) => s.dir === 'recv');
  assert.equal(recvs.length, 2, JSON.stringify(recvs));
  assert.equal(recvs[0].kind, 'flux');
  assert.equal(recvs[1].kind, 'ref');
  const known = ca.fluxKnown.get(idB);
  assert.ok(known && known.size >= 1, 'accusé dedup absent (fluxKnown vide)');
});

test('fil flux : ref inconnue refusée, réaffectation pleine réussit', async () => {
  const { ca, cb, stubA, stubB, idB } = wirePair();
  void cb;
  // Tâche manuelle affectée à B, puis injection d'une ref forgée.
  const task = ca.queue.submit(
    { op: 'fib', args: { n: 10 }, redundancy: 1, timeoutMs: 15000, coordinatorId: stubA.id },
    (o, x) => require('../src/ops').runOp(o, x)
  );
  ca.queue.assign(task, idB, () => {});
  const seen = [];
  stubB.on('exec-failed', (e) => seen.push(e));
  // Injection directe côté B d'une ref que B ne détient pas.
  await cb._handleTask(stubA.id, { v: 1, taskId: task.id, op: 'fib', ref: 'ff'.repeat(32) });
  assert.ok(seen.some((e) => e.error === 'flux-unknown-ref'), `refus non signalé : ${JSON.stringify(seen)}`);
  assert.equal(task.results.size, 0, 'la ref inconnue a voté');
  // La vraie charge passe toujours : le chemin nominal n'est pas cassé.
  const r = await ca.submit('fib', { n: 10 }, { redundancy: 1, timeoutMs: 15000 });
  assert.equal(r.outcome, 'done');
  assert.equal(r.value, 55);
});

test('fil flux : invalidation timeout oublie la ref (renvoi plein)', async () => {
  const { ca, idB } = wirePair();
  const text = 'données répétées pour test invalidation '.repeat(100);
  const r1 = await ca.submit('wordcount', { text }, { redundancy: 1, timeoutMs: 15000 });
  assert.equal(r1.outcome, 'done');
  assert.ok((ca.fluxKnown.get(idB) || new Set()).size >= 1, 'pas de ref apprise');
  // Simulation d'une invalidation (timeout/panne) : la ref est oubliée.
  const fakeTask = { id: 't-inv', fluxRefs: [...(ca.fluxKnown.get(idB) || [])] };
  ca._fluxForget(fakeTask);
  assert.equal((ca.fluxKnown.get(idB) || new Set()).size, 0, 'ref non oubliée après invalidation');
  assert.deepEqual(fakeTask.fluxRefs, [], 'fluxRefs tâche non purgés');
});

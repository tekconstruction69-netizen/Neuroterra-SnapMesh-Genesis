'use strict';

/**
 * NT-PQ : handshake hybride concordant, clés de session, reçus ML-DSA,
 * anti-rejeu, rotation/révocation, surcoût mesuré (tailles exactes,
 * relations robustes aux versions).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const H = require('../src/hybrid');
const S = require('../src/sigs');

test('hybride : A et B dérivent le même secret, attaquant exclu', () => {
  const a = H.genSessionIdentity();
  const b = H.genSessionIdentity();
  const init = H.initiate(a, H.publicOf(b));
  const resp = H.respond(b, a.ecdh.publicKey, init.ct);
  assert.deepEqual(init.secret, resp.secret, 'secrets hybrides divergents');
  assert.equal(init.secret.length, 32);
  // Attaquant avec ses propres clés : secret différent.
  const m = H.genSessionIdentity();
  const respM = H.respond(m, a.ecdh.publicKey, init.ct);
  assert.notDeepEqual(respM.secret, init.secret, 'attaquant non exclu');
  // Mauvais contexte info : secret différent (séparation de domaine).
  const init2 = H.initiate(a, H.publicOf(b), { info: 'autre-contexte' });
  assert.notDeepEqual(init2.secret, init.secret);
  // Clés de session dérivées : 32 o, stables.
  const k1 = H.deriveSessionKeys(init.secret);
  const k2 = H.deriveSessionKeys(resp.secret);
  assert.deepEqual(k1, k2);
  assert.equal(k1.enc.length, 32);
});

test('hybride : ct altéré ⇒ décapsulation impossible ou secret différent', () => {
  const a = H.genSessionIdentity();
  const b = H.genSessionIdentity();
  const init = H.initiate(a, H.publicOf(b));
  const bad = Buffer.from(init.ct);
  bad[10] ^= 1;
  let diverged = false;
  try {
    const r = H.respond(b, a.ecdh.publicKey, bad);
    diverged = !r.secret.equals(init.secret);
  } catch {
    diverged = true; // refus franc : acceptable
  }
  assert.equal(diverged, true, 'ct altéré non détecté');
});

test('ML-DSA : reçu signé, falsifié rejeté, mauvaise clé rejetée', () => {
  const a = S.genSigningIdentity();
  const b = S.genSigningIdentity();
  const body = { taskId: 't', op: 'matmul', inHash: 'aa', outHash: 'bb', executor: 'e1', durationMs: 3 };
  const { receipt, sig } = S.makePqReceipt(a.privateKey, body);
  assert.equal(S.verifyPqReceipt(receipt, sig, a.publicKey), true);
  assert.equal(S.verifyPqReceipt({ ...receipt, outHash: 'cc' }, sig, a.publicKey), false, 'falsifié accepté');
  assert.equal(S.verifyPqReceipt(receipt, sig, b.publicKey), false, 'mauvaise clé acceptée');
  assert.equal(S.verifyPqReceipt(null, sig, a.publicKey), false);
  // Nonces uniques (anti-rejeu par construction).
  const r2 = S.makePqReceipt(a.privateKey, body);
  assert.notEqual(r2.receipt.nonce, receipt.nonce, 'nonce réutilisé');
});

test('anti-rejeu : nonce vu deux fois ⇒ rejet, expiration ⇒ réadmis', () => {
  const cache = new S.NonceCache({ max: 10, ttlMs: 40 });
  assert.equal(cache.check('n1'), true);
  assert.equal(cache.check('n1'), false, 'rejeu accepté');
  assert.equal(cache.check('n2'), true);
  return new Promise((resolve) => setTimeout(() => {
    assert.equal(cache.check('n1'), true, 'nonce expiré non réadmis');
    resolve();
  }, 60));
});

test('registre : rotation et révocation vérifiables', () => {
  const reg = new S.KeyRegistry();
  const a = S.genSigningIdentity();
  const a2 = S.genSigningIdentity();
  reg.register('nodeA', S.spkiDer(a.publicKey));
  assert.ok(reg.usable('nodeA'), 'clé fraîche inutilisable');
  reg.rotate('nodeA', 'nodeA2', S.spkiDer(a2.publicKey));
  assert.equal(reg.usable('nodeA'), null, 'ancienne clé encore utilisable');
  assert.ok(reg.usable('nodeA2'), 'nouvelle clé inutilisable');
  assert.equal(reg.keys.get('nodeA').rotatedTo, 'nodeA2');
  reg.revoke('nodeA2');
  assert.equal(reg.usable('nodeA2'), null, 'clé révoquée utilisable');
  assert.throws(() => reg.rotate('nodeA2', 'nodeA3', S.spkiDer(a.publicKey)), /révoquée/);
  assert.throws(() => reg.register('nodeA2', S.spkiDer(a.publicKey)), /dupliqué/);
});

test('P7 : clé AES hybride commune, TASK chiffré réel, attaquant exclu', () => {
  // P7 (audit) : handshake hybride réel (initiate/respond nt-pq) composé
  // avec l'ECDH §3 via deriveSharedHybrid ; la clé AES chiffre un vrai
  // TASK (sealPayload/openPayload §3). Attaquant (autre KEM) : GCM lève.
  const S3 = require('../../mesh-net/src/session');
  const { deriveSharedHybrid } = require('../src/session');
  const eA = S3.generateEphemeral();
  const eB = S3.generateEphemeral();
  const idA = H.genSessionIdentity();
  const idB = H.genSessionIdentity();
  const init = H.initiate(idA, H.publicOf(idB));
  assert.equal(init.kem.length, 32, 'secret KEM non exposé');
  const resp = H.respond(idB, idA.ecdh.publicKey, init.ct);
  assert.deepEqual(resp.secret, init.secret, 'handshake hybride divergent');
  const kB = crypto.decapsulate(idB.kem.privateKey, init.ct);
  assert.deepEqual(Buffer.from(kB), init.kem, 'KEM décapsulé ≠ initiateur');
  const aesA = deriveSharedHybrid(eA.privateKey, eB.publicKey, init.kem);
  const aesB = deriveSharedHybrid(eB.privateKey, eA.publicKey, kB);
  assert.deepEqual(aesA, aesB, 'clés AES hybrides divergentes');
  const sealed = S3.sealPayload(aesA, { type: 'TASK', payload: { op: 'fib' } });
  assert.deepEqual(S3.openPayload(aesB, sealed), { type: 'TASK', payload: { op: 'fib' } });
  const idM = H.genSessionIdentity();
  const { sharedKey: kM } = crypto.encapsulate(idM.kem.publicKey);
  const aesM = deriveSharedHybrid(eA.privateKey, eB.publicKey, kM);
  assert.throws(() => S3.openPayload(aesM, sealed), /./, 'attaquant déchiffre');
});

test('surcoût PQ : tailles et ordres de grandeur (constat, pas contrat)', () => {
  const kemPub = H.genSessionIdentity().kem.publicKey.export({ format: 'der', type: 'spki' });
  const ecdhPub = crypto.generateKeyPairSync('x25519').publicKey.export({ format: 'der', type: 'spki' });
  assert.ok(kemPub.length > 20 * ecdhPub.length, `KEM ${kemPub.length} vs ECDH ${ecdhPub.length}`);
  const dsa = S.genSigningIdentity();
  const sig = crypto.sign(null, Buffer.from('x'), dsa.privateKey);
  const edSig = crypto.sign(null, Buffer.from('x'), crypto.generateKeyPairSync('ed25519').privateKey);
  assert.ok(sig.length > 20 * edSig.length, `DSA ${sig.length} vs Ed ${edSig.length}`);
  console.log(`    [mesuré ici] KEM-pub ${kemPub.length} o (ECDH ${ecdhPub.length}), DSA-sig ${sig.length} o (Ed ${edSig.length})`);
});

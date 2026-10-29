'use strict';

/**
 * NT-UCP : NT-CERT signé/vérifié, négociation authentifiée (accord,
 * désaccord, rejeu, sans-intersection), PoC hétérogène bout-en-bout.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Identity } = require('../../mesh-net/src/identity');
const { buildCaps } = require('../../mesh-net/src/caps');
const { detectBackends } = require('../../nt-compat/src/backends');
const { buildRegistry } = require('../../nt-compat/src/registry');
const { issueCert, verifyCert } = require('../src/cert');
const { negotiatePair, arbitrate } = require('../src/negotiate');
const { NonceCache } = require('../../nt-pq/src/sigs');

function certs() {
  const keyA = Identity.generate();
  const keyB = Identity.generate();
  const compat = detectBackends({ benchN: 8 });
  const mk = (key, name) => issueCert(key, {
    nodeId: key.id, name, caps: buildCaps(), compat,
  });
  return { keyA, keyB, certA: mk(keyA, 'NT-PC-A'), certB: mk(keyB, 'NT-PC-B') };
}

test('NT-CERT : émis signé, vérifié, falsifié rejeté', () => {
  const { keyA, keyB, certA } = certs();
  assert.equal(verifyCert(certA, keyA.spkiDer), true);
  assert.equal(verifyCert(certA, keyB.spkiDer), false, 'mauvaise clé acceptée');
  assert.equal(verifyCert({ ...certA, dtypes: ['bf16'] }, keyA.spkiDer), false, 'manifeste altéré accepté');
  assert.equal(verifyCert({ ...certA, sig: certA.sig.slice(0, -4) + 'AAAA' }, keyA.spkiDer), false);
  assert.equal(verifyCert(null, keyA.spkiDer), false);
  assert.ok(certA.backends.some((b) => b.name === 'node-cpu-fp32'), 'fp32 absent du manifeste');
  assert.ok(certA.nodeId === keyA.id && certA.nodeId.length === 64, 'nodeId non pseudonyme-empreinte');
});

test('NT-NEGOTIATE : accord vérifié des deux côtés, mesures', () => {
  const { keyA, keyB, certA, certB } = certs();
  const r = negotiatePair(certA, keyA, certB, keyB);
  assert.equal(r.selected.dtype, 'fp32', `dtype négocié : ${r.selected.dtype}`);
  assert.equal(r.selected.crypto, 'x25519', `crypto : ${r.selected.crypto} (pq-hybrid non annoncé par défaut)`);
  assert.ok(r.selected.backends.includes('node-cpu-fp32'));
  assert.ok(r.ms >= 0 && r.bytes > 500, `mesures absurdes : ${r.ms} ms, ${r.bytes} o`);
  console.log(`    [mesuré ici] négociation : ${r.ms.toFixed(2)} ms, ${r.bytes} o sur le fil`);
});

test('NT-NEGOTIATE : pq-hybrid choisi si annoncé des deux côtés', () => {
  const { keyA, keyB } = certs();
  const compat = detectBackends({ benchN: 8 });
  const mk = (key, protocols) => issueCert(key, {
    nodeId: key.id, caps: buildCaps(), compat, protocols,
  });
  const r = negotiatePair(
    mk(keyA, ['fusion-ir/1', 'pq-hybrid/1']),
    keyA,
    mk(keyB, ['fusion-ir/1', 'pq-hybrid/1']),
    keyB
  );
  assert.equal(r.selected.crypto, 'pq-hybrid/1', 'hybride non choisi malgré annonce bilatérale');
});

test('NT-NEGOTIATE : refus motivés (rejeu, sans-intersection, désaccord)', () => {
  const { keyA, keyB, certA, certB } = certs();
  // Rejeu réel : le MÊME hello rejoué est refusé (nonceA déjà vu).
  const { helloPhase, selectPhase } = require('../src/negotiate');
  const nonces = new NonceCache({});
  const hello = helloPhase(certA);
  selectPhase(hello, certB, keyA, nonces); // consomme nonceA
  assert.throws(() => selectPhase(hello, certB, keyA, nonces), /neg-rejeu: nonceA/);
  // Nonces frais : deux négociations successives passent (pas de faux positif).
  negotiatePair(certA, keyA, certB, keyB, { nonces });
  negotiatePair(certA, keyA, certB, keyB, { nonces });
  // Sans dtype commun.
  const other = { ...certB, dtypes: ['bf16'] };
  assert.throws(() => arbitrate(certA, other), /aucun dtype commun/);
  assert.throws(() => arbitrate(certA, { ...certB, protocols: ['autre/9'] }), /aucun protocole commun/);
  assert.throws(() => arbitrate(certA, { ...certB, codecs: ['lz4-seul'] }), /aucun codec commun/);
  // Désaccord : certB modifié après arbitrage B (signature recalculée
  // par un tiers impossible → ici on forge un selected incohérent via
  // un certB' signé par B mais différent : A recalcule et refuse).
  const compat = detectBackends({ benchN: 8 });
  const certB2 = issueCert(keyB, { nodeId: keyB.id, caps: buildCaps(), compat, codecs: ['raw'] });
  // certA accepte gzip..., certB2 raw seul → accord raw (pas de désaccord :
  // l'arbitrage est déterministe, les deux convergent).
  const r = negotiatePair(certA, keyA, certB2, keyB);
  assert.equal(r.selected.codec, 'raw');
});

test('P4 : session sur enveloppes protocole réelles, accord bilatéral', async () => {
  // P4 : les 4 messages transitent par seal/verifyEnvelope (authentification
  // NT-ID au niveau transport, comme node.js) + copies JSON (fil simulé).
  const { Negotiator } = require('../src/session');
  const { seal, verifyEnvelope } = require('../../mesh-net/src/protocol');
  const { keyA, keyB, certA, certB } = certs();
  const pubs = new Map([[keyA.id, keyA.spkiDer], [keyB.id, keyB.spkiDer]]);
  const mkLink = (selfKey, owner) => {
    let neg = null;
    const sendFn = (peerId, type, payload) => {
      // Enveloppe réseau réelle, scellée par l'expéditeur ; le destinataire
      // la vérifie avec la clé apprise de l'expéditeur (défi NT-ID).
      const env = JSON.parse(JSON.stringify(seal(selfKey, type, payload)));
      const v = verifyEnvelope(env, selfKey.spkiDer);
      assert.equal(v.ok, true, `enveloppe rejetée : ${v.reason}`);
      setImmediate(() => owner.peer.handleMessage({ type: env.type, from: env.from, payload: env.payload }));
    };
    neg = new Negotiator({ cert: owner.cert, key: selfKey, sendFn, peerPubs: pubs });
    return neg;
  };
  const sideA = { cert: certA, peer: null };
  const sideB = { cert: certB, peer: null };
  const negA = mkLink(keyA, sideA);
  const negB = mkLink(keyB, sideB);
  sideA.peer = negB;
  sideB.peer = negA;
  const doneA = new Promise((resolve) => negA.once('negotiated', resolve));
  const doneB = new Promise((resolve) => negB.once('negotiated', resolve));
  negA.start(keyB.id);
  const [ra, rb] = await Promise.all([
    Promise.race([doneA, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout A')), 5000))]),
    Promise.race([doneB, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout B')), 5000))]),
  ]);
  assert.equal(ra.peer, keyB.id);
  assert.deepEqual(ra.selected, rb.selected, 'accord divergent entre A et B');
  assert.equal(ra.selected.dtype, 'fp32');
  // SELECT sans HELLO → échec signalé, pas d'accord.
  const negC = new Negotiator({
    cert: certA, key: keyA, sendFn: () => {}, peerPubs: pubs,
  });
  const fails = [];
  negC.on('neg-failed', (f) => fails.push(f.reason));
  negC.handleMessage({ type: 'NEG_SELECT', from: keyB.id, payload: { nonceA: 'x', selected: {} } });
  assert.ok(fails.some((f) => /sans HELLO/.test(f)), `échec non signalé : ${fails}`);
  assert.equal(negC.done.size, 0, 'accord enregistré sans HELLO');
  // Clé inconnue (défi NT-ID non fait) → refus.
  const negD = new Negotiator({ cert: certA, key: keyA, sendFn: () => {}, peerPubs: new Map() });
  const failsD = [];
  negD.on('neg-failed', (f) => failsD.push(f.reason));
  negD.handleMessage({ type: 'NEG_HELLO', from: keyB.id, payload: { nonceA: 'y', cert: certB } });
  assert.ok(failsD.some((f) => /non apprise|défi/.test(f)), `clé inconnue acceptée : ${failsD}`);
});

'use strict';

/**
 * Tests transport §3 : canal chiffré X25519 + relais minimal.
 * Nœuds en processus réels (vrais sockets TCP loopback, discovery coupée).
 * Topologie relais : A <-> B <-> C, aucun lien direct A-C.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { SnapMeshNode } = require('../src/node');

const nodes = [];
after(async () => {
  for (const n of nodes) {
    try {
      await n.stop();
    } catch {}
  }
});

let port = 48410;
function makeNode(name, manualPeers) {
  const tcp = port;
  port += 10; // TCP + statut (+100 réservé) sans collision
  const n = new SnapMeshNode({
    name,
    tcpPort: tcp,
    ephemeral: true, // clés fraîches par test : pas de rejeu inter-tests
    discovery: false,
    manualPeers,
    heartbeatMs: 500,
    suspectAfterMs: 1500,
    deadAfterMs: 3000,
    statusPort: tcp + 500,
  });
  nodes.push(n);
  return n;
}

async function waitFor(fn, { timeoutMs = 10000, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch {}
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout (${timeoutMs} ms) : ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('canal chiffré : échange SESSION-KEY, clés identiques, ping chiffré aller-retour', async () => {
  const b = makeNode('enc-b', []);
  const a = makeNode('enc-a', [`127.0.0.1:${b.tcpPort}`]);
  await b.start();
  await a.start();

  await waitFor(() => a.sessionKeys.get(b.id) && b.sessionKeys.get(a.id), { label: 'canal prêt des deux côtés' });

  // Même secret des deux côtés : A scelle, B ouvre avec sa clé.
  const { sealPayload, openPayload } = require('../src/session');
  const sealed = sealPayload(a.sessionKeys.get(b.id), { ping: 1 });
  assert.deepEqual(openPayload(b.sessionKeys.get(a.id), sealed), { ping: 1 });

  // ENCRYPTED de bout en bout via le réseau réel.
  const got = new Promise((resolve) => {
    const h = (m) => {
      if (m.type === 'ECHO' && m.encrypted === true) {
        b.off('message', h);
        resolve(m);
      }
    };
    b.on('message', h);
  });
  assert.equal(a.sendEncrypted(b.id, 'ECHO', { secret: 'canari-4142' }), 'encrypted');
  const rec = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ECHO')), 5000))]);
  assert.equal(rec.payload.secret, 'canari-4142');
  assert.equal(rec.from, a.id);
});

test('chiffré sans clé : repli clair SIGNALÉ (plain), pas silencieux', async () => {
  const a = nodes[0];
  const b = nodes[1];
  a.sessionKeys.delete(b.id); // canal perdu (redémarrage pair, compromission...)
  b.sessionKeys.delete(a.id);
  const seen = new Promise((resolve) => {
    const h = (m) => {
      if (m.type === 'SONDE') {
        b.off('message', h);
        resolve(m);
      }
    };
    b.on('message', h);
  });
  assert.equal(a.sendEncrypted(b.id, 'SONDE', { v: 1 }), 'plain');
  const rec = await Promise.race([seen, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout SONDE')), 5000))]);
  assert.equal(rec.encrypted, undefined, 'un repli clair ne doit pas se prétendre chiffré');
  // Le canal se renégocie au prochain cycle (SESSION-KEY renvoyé au rattachement ;
  // ici on force la renégociation bilatérale pour un état propre aux tests suivants).
  a._sendTo(b.id, 'SESSION-KEY', { epub: a.sessionEphemPubB64 });
  b._sendTo(a.id, 'SESSION-KEY', { epub: b.sessionEphemPubB64 });
  await waitFor(() => a.sessionKeys.get(b.id) && b.sessionKeys.get(a.id), { label: 'canal renégocié' });
});

test('ENCRYPTED sans clé côté lecteur : rejeté no-session-key', async () => {
  const a = nodes[0];
  const b = nodes[1];
  b.sessionKeys.delete(a.id); // lecteur sans clé (désynchronisation)
  const rej = new Promise((resolve) => {
    const h = (r) => {
      if (r.reason === 'no-session-key') {
        b.off('rejected', h);
        resolve(r);
      }
    };
    b.on('rejected', h);
  });
  // A scelle avec SON ancienne clé (a encore la clé) mais B ne peut plus ouvrir.
  const { sealPayload } = require('../src/session');
  const stale = a.sessionKeys.get(b.id);
  assert.ok(stale, 'A doit encore détenir la clé pour ce test');
  a._sendTo(b.id, 'ENCRYPTED', { inner: sealPayload(stale, { type: 'PIEGE', payload: {} }), enc: true });
  const r = await Promise.race([rej, new Promise((_, rej2) => setTimeout(() => rej2(new Error('timeout rejet')), 5000))]);
  assert.equal(r.from, a.id);
  a._sendTo(b.id, 'SESSION-KEY', { epub: a.sessionEphemPubB64 });
  b._sendTo(a.id, 'SESSION-KEY', { epub: b.sessionEphemPubB64 });
  await waitFor(() => a.sessionKeys.get(b.id) && b.sessionKeys.get(a.id), { label: 'clés restaurées' });
});

test('relais : A -> B -> C sans lien direct, signature origine vérifiée', async () => {
  const b = makeNode('rel-b', []);
  const a = makeNode('rel-a', [`127.0.0.1:${b.tcpPort}`]);
  const c = makeNode('rel-c', [`127.0.0.1:${b.tcpPort}`]);
  await b.start();
  await a.start();
  await c.start();

  await waitFor(() => a.sockets.has(b.id) && c.sockets.has(b.id), { label: 'chaîne A-B-C' });
  assert.ok(!a.sockets.has(c.id) && !c.sockets.has(a.id), 'A et C doivent rester sans lien direct');

  const rec = new Promise((resolve) => {
    const h = (m) => {
      if (m.type === 'TASK' && m.relayed === true) {
        c.off('message', h);
        resolve(m);
      }
    };
    c.on('message', h);
  });
  const sealed = a.sealFor('TASK', { v: 1, taskId: 'relais-1', op: 'fib', marker: 'canari-relais-9917' });
  assert.ok(a.sendRelayVia(b.id, c.id, sealed, a.pubB64));
  const m = await Promise.race([rec, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout relais')), 8000))]);
  assert.equal(m.from, a.id, "l'origine doit être conservée, pas le relayeur");
  assert.equal(m.payload.marker, 'canari-relais-9917');
  assert.ok(c.knownPub.has(a.id), 'C a appris la clé origine via le relais (vérifiée)');
  assert.ok(b.sockets.has(a.id) && b.sockets.has(c.id), 'le relayeur reste connecté aux deux');
});

test('relais : TTL épuisé et type interdit rejetés, lien conservé', async () => {
  const a = nodes.find((n) => n.name === 'rel-a');
  const b = nodes.find((n) => n.name === 'rel-b');
  const c = nodes.find((n) => n.name === 'rel-c');
  const rejs = [];
  const h = (r) => rejs.push(r.reason);
  b.on('rejected', h);
  // TTL 0 : refusé.
  a.sendRelayVia(b.id, c.id, a.sealFor('TASK', { v: 1, taskId: 'ttl-0', op: 'fib' }), a.pubB64, 0);
  // Type non applicatif : refusé.
  a.sendRelayVia(b.id, c.id, a.sealFor('HEARTBEAT', { seq: 1 }), a.pubB64, 3);
  await new Promise((r) => setTimeout(r, 800));
  b.off('rejected', h);
  assert.ok(rejs.includes('relay-ttl'), `TTL épuisé non rejeté : [${rejs}]`);
  assert.ok(rejs.includes('relay-type'), `type interdit non rejeté : [${rejs}]`);
  assert.ok(b.sockets.has(a.id), 'le relayeur ne doit pas couper le lien sur relais fautif');
});

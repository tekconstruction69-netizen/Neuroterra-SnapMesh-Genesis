'use strict';

/** Tests unitaires M1 : identité, protocole, registre. Aucun réseau. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Identity, fingerprintOfPublicKey } = require('../src/identity');
const { seal, verifyEnvelope, validNtName, LineFramer } = require('../src/protocol');
const { Registry } = require('../src/registry');
const { SnapMeshNode } = require('../src/node');

// ---------- identité ----------

test('identité : id == empreinte de la clé publique, signature vérifiée', () => {
  const id = Identity.generate();
  assert.equal(id.id, fingerprintOfPublicKey(id.spkiDer));
  assert.equal(id.id.length, 64);
  const sig = id.sign(Buffer.from('bonjour'));
  assert.ok(Identity.verifyWith(id.spkiDer, Buffer.from('bonjour'), sig));
});

test('identité : message falsifié rejeté', () => {
  const a = Identity.generate();
  const b = Identity.generate();
  const sig = a.sign(Buffer.from('vrai'));
  assert.equal(Identity.verifyWith(a.spkiDer, Buffer.from('faux'), sig), false);
  assert.equal(Identity.verifyWith(b.spkiDer, Buffer.from('vrai'), sig), false);
});

test('identité : persistance fichier conserve le même id', () => {
  const dir = path.join(__dirname, '.tmp-unit');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'n.key');
  const a = Identity.generate();
  a.saveToFile(f);
  const b = Identity.loadFromFile(f);
  assert.equal(b.id, a.id);
});

// ---------- protocole ----------

test('protocole : HELLO scellé puis vérifié, clé apprise réutilisée', () => {
  const a = Identity.generate();
  const hello = seal(a, 'HELLO', { name: 'a' });
  const v = verifyEnvelope(hello, null);
  assert.ok(v.ok);
  const hb = seal(a, 'HEARTBEAT', { seq: 1 });
  assert.ok(verifyEnvelope(hb, v.pub).ok);
});

test('protocole : charge falsifiée rejetée', () => {
  const a = Identity.generate();
  const hb = seal(a, 'HEARTBEAT', { seq: 1 });
  hb.payload.seq = 999; // altération après signature
  const v = verifyEnvelope(hb, Buffer.from(a.publicKeyB64, 'base64'));
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'bad-signature');
});

test('protocole : expéditeur inconnu et horodatage périmé rejetés', () => {
  const a = Identity.generate();
  const hb = seal(a, 'HEARTBEAT', {});
  assert.equal(verifyEnvelope(hb, null).ok, false);
  const old = seal(a, 'HEARTBEAT', {});
  old.ts = Date.now() - 10 * 60 * 1000;
  const pub = Buffer.from(a.publicKeyB64, 'base64');
  assert.equal(verifyEnvelope(old, pub).ok, false);
});

test('protocole : usurpation id/clé détectée sur HELLO', () => {
  const a = Identity.generate();
  const b = Identity.generate();
  const hello = seal(a, 'HELLO', {});
  hello.from = b.id; // l'attaquant colle son id sur la clé de a
  assert.equal(verifyEnvelope(hello, null).ok, false);
});

test('protocole : trames non-objet (null, tableau, nombre) rejetées sans planter', () => {
  const got = [];
  const errs = [];
  const f = new LineFramer(
    (m) => got.push(m),
    (e) => errs.push(e.message)
  );
  f.push(Buffer.from('null\n[1,2]\n42\n"str"\n{"ok":1}\n'));
  assert.deepEqual(got, [{ ok: 1 }]);
  assert.equal(errs.length, 4);
  assert.ok(errs.every((m) => m === 'bad-frame'));
});

test('protocole : UTF-8 fragmenté entre deux segments TCP reconstitué', () => {
  const got = [];
  const f = new LineFramer((m) => got.push(m), () => {});
  const raw = Buffer.from('{"emoji":"é"}\n', 'utf8');
  // Coupe au milieu du caractère multi-octets.
  const cut = raw.indexOf(Buffer.from([0xc3])) + 1;
  assert.ok(cut > 1 && cut < raw.length);
  f.push(raw.slice(0, cut));
  assert.deepEqual(got, []);
  f.push(raw.slice(cut));
  assert.deepEqual(got, [{ emoji: 'é' }]);
});

test('protocole : HELLO auto-cohérent mais clé invalide rejeté sans exception', () => {
  const garbage = require('node:crypto').randomBytes(64); // pas une clé SPKI
  const from = fingerprintOfPublicKey(garbage); // l'attaquant calcule from lui-même
  const env = {
    v: 1,
    type: 'HELLO',
    from,
    ts: Date.now(),
    payload: {},
    pub: garbage.toString('base64'),
    sig: Buffer.alloc(64).toString('base64'),
  };
  let res;
  assert.doesNotThrow(() => {
    res = verifyEnvelope(env, null);
  });
  assert.equal(res.ok, false);
});

test('protocole : framer découpe les trames et isole le mauvais JSON', () => {
  const got = [];
  const errs = [];
  const f = new LineFramer(
    (m) => got.push(m),
    (e) => errs.push(e.message)
  );
  f.push(Buffer.from('{"a":1}\n{"b":'));
  f.push(Buffer.from('2}\nPAS-DU-JSON\n{"c":3}\n'));
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }, { c: 3 }]);
  assert.deepEqual(errs, ['bad-json']);
});

// ---------- registre ----------

test('nœud : enveloppe null reçue -> rejet, pas d\'exception', () => {
  const node = new SnapMeshNode({ name: 't', tcpPort: 49998, ephemeral: true, discovery: false });
  const rejected = [];
  node.on('rejected', (r) => rejected.push(r.reason));
  const fake = { remoteAddress: '9.9.9.9', remotePort: 1, destroyed: false, destroy() { this.destroyed = true; } };
  assert.doesNotThrow(() => node._onMessage(null, fake, null, null, 'in'));
  assert.ok(fake.destroyed);
  assert.ok(rejected.length >= 1);
});

test('nt-id : noms lisibles validés (affichage seul, pas preuve)', () => {
  assert.ok(validNtName('NT-PC') && validNtName('NT-IPHONE-12') && validNtName('NT-SERVER-01'));
  assert.ok(!validNtName('bob') && !validNtName('NT-toto') && !validNtName('NT-' + 'X'.repeat(25)) && !validNtName(42));
});

test('nt-id : enveloppe rejouée ignorée sans effet', () => {
  const node = new SnapMeshNode({ name: 't', tcpPort: 49997, ephemeral: true, discovery: false });
  const rejected = [];
  node.on('rejected', (r) => rejected.push(r.reason));
  const wrote = [];
  const fake = { remoteAddress: '9.9.9.9', remotePort: 1, write: (d) => wrote.push(d), destroy() {}, _mesh: {} };
  const id = Identity.generate();
  const hello = JSON.parse(JSON.stringify(seal(id, 'HELLO', { name: 'NT-PC' })));
  node._onMessage(null, fake, null, hello, 'in');
  assert.equal(node.sockets.size, 1, 'premier HELLO rattaché');
  node._onMessage(null, fake, null, JSON.parse(JSON.stringify(hello)), 'in');
  assert.ok(rejected.includes('replay'), 'second envoi identique = rejeu');
  assert.equal(node.sockets.size, 1, 'pas de double rattachement');
});

test('nt-id : renouvellement avalisé par ancienne clé enregistré', () => {
  const node = new SnapMeshNode({ name: 't', tcpPort: 49996, ephemeral: true, discovery: false });
  const renewed = [];
  node.on('renewed', (e) => renewed.push(e));
  const oldId = Identity.generate();
  const newId = Identity.generate();
  node.knownPub.set(oldId.id, oldId.spkiDer);
  const sigByOld = oldId.sign(Buffer.from(newId.id, 'utf8')).toString('base64');
  node._handleRenew(oldId.id, { oldId: oldId.id, newPubB64: newId.publicKeyB64, sigByOld });
  assert.equal(renewed.length, 1);
  assert.equal(node.registry.get(oldId.id), null); // jamais HELLO : pas de fiche, mais pas d'exception
  node.registry.upsert({ id: oldId.id });
  node._handleRenew(oldId.id, { oldId: oldId.id, newPubB64: newId.publicKeyB64, sigByOld });
  assert.equal(node.registry.get(oldId.id).successor, newId.id);
  // Faux aval : signature d'une autre clé -> ignoré.
  const other = Identity.generate();
  const bad = other.sign(Buffer.from(newId.id, 'utf8')).toString('base64');
  node._handleRenew(oldId.id, { oldId: oldId.id, newPubB64: newId.publicKeyB64, sigByOld: bad });
  assert.equal(renewed.length, 2, 'seul le bon aval compte');
});

test('nt-cap : profil versionné signé, falsifié rejeté, GPU marqué indisponible', () => {
  const { buildCaps, signCaps, verifyCaps, CAPS_V } = require('../src/caps');
  const id = Identity.generate();
  const caps = buildCaps({});
  assert.equal(caps.v, CAPS_V);
  assert.equal(caps.gpu.available, false);
  assert.equal(caps.npu.available, false);
  assert.ok(caps.cpu.threads >= 1 && caps.ram.total > 0);
  const signed = signCaps(id, caps);
  assert.ok(verifyCaps(signed, id.publicKeyB64));
  const fake = { ...signed, cpu: { ...signed.cpu, threads: 9999 } };
  assert.equal(verifyCaps(fake, id.publicKeyB64), false, 'profil altéré rejeté');
  const other = Identity.generate();
  assert.equal(verifyCaps(signed, other.publicKeyB64), false, 'mauvaise clé rejetée');
});

test('nt-id : révocation exclut de la vue live', () => {
  const r = new Registry();
  r.upsert({ id: 'y'.repeat(64), name: 'NT-PC' });
  assert.equal(r.live().length, 1);
  r.revoke('y'.repeat(64), 'clé compromise');
  assert.ok(r.isRevoked('y'.repeat(64)));
  assert.equal(r.live().length, 0, 'révoqué hors exploitation');
  assert.equal(r.all().length, 1, 'gardé pour audit');
});

test('registre : cycle connected -> suspect -> dead, seq périmée ignorée', () => {
  const r = new Registry();
  r.upsert({ id: 'x'.repeat(64), name: 'x' });
  assert.equal(r.live().length, 1);
  assert.equal(r.touch('x'.repeat(64), 5).lastSeq, 5);
  assert.equal(r.touch('x'.repeat(64), 5), 'stale-seq');
  r.setState('x'.repeat(64), 'suspect');
  assert.equal(r.live()[0].state, 'suspect');
  r.setState('x'.repeat(64), 'dead');
  assert.equal(r.live().length, 0); // mort : hors vue d'exploitation
  assert.equal(r.all().length, 1); // mais gardé en historique
});

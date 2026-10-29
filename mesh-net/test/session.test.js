'use strict';

/** Tests unitaires sessions NT chiffrées : X25519 + AES-256-GCM. Aucun réseau. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  generateEphemeral,
  exportRaw,
  importRawPeer,
  deriveShared,
  sealPayload,
  openPayload,
} = require('../src/session');

function pairedKeys() {
  const a = generateEphemeral();
  const b = generateEphemeral();
  const ka = deriveShared(a.privateKey, importRawPeer(exportRaw(b.publicKey)));
  const kb = deriveShared(b.privateKey, importRawPeer(exportRaw(a.publicKey)));
  return { ka, kb };
}

test('session : clés dérivées identiques des deux côtés ( consultation croisée )', () => {
  const { ka, kb } = pairedKeys();
  assert.equal(ka.length, 32);
  assert.ok(ka.equals(kb), 'Diffie-Hellman asymétrique : échec de dérivation');
});

test('session : scellé puis ouvert, contenu intact', () => {
  const { ka, kb } = pairedKeys();
  const sealed = sealPayload(ka, { type: 'TASK', payload: { op: 'fib', n: 25 } });
  assert.ok(sealed.iv && sealed.data && sealed.tag, 'enveloppe incomplète');
  const open = openPayload(kb, sealed);
  assert.equal(open.type, 'TASK');
  assert.equal(open.payload.n, 25);
});

test('session : octet altéré dans les données -> rejet (authentification GCM)', () => {
  const { ka, kb } = pairedKeys();
  const sealed = sealPayload(ka, { hello: 'monde' });
  const buf = Buffer.from(sealed.data, 'base64');
  buf[0] ^= 0x01; // falsification sur le fil
  sealed.data = buf.toString('base64');
  assert.throws(() => openPayload(kb, sealed), 'ciphertext altéré accepté');
});

test('session : étiquette altérée -> rejet', () => {
  const { ka, kb } = pairedKeys();
  const sealed = sealPayload(ka, { hello: 'monde' });
  const tag = Buffer.from(sealed.tag, 'base64');
  tag[tag.length - 1] ^= 0x01;
  sealed.tag = tag.toString('base64');
  assert.throws(() => openPayload(kb, sealed), 'tag altéré accepté');
});

test('session : mauvaise clé -> rejet (pas de lecture croisée)', () => {
  const { ka } = pairedKeys();
  const sealed = sealPayload(ka, { secret: 1 });
  const stranger = pairedKeys().ka; // paire indépendante
  assert.throws(() => openPayload(stranger, sealed), 'clé étrangère acceptée');
});

test('session : clé éphémère régénérée à chaque démarrage (pas de rejeu inter-processus)', () => {
  const k1 = exportRaw(generateEphemeral().publicKey).toString('base64');
  const k2 = exportRaw(generateEphemeral().publicKey).toString('base64');
  assert.notEqual(k1, k2, 'clés éphémères identiques : aléa défaillant');
});

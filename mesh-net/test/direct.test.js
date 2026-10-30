'use strict';

/**
 * SnapMesh Direct : trames, TTL, boucles, remise multi-sauts et bascule.
 * Transport en mémoire = MÊME HÔTE (étiqueté) ; aucune radio simulée
 * comme réelle. Le test 2 PC sans box reste NON EXÉCUTÉ (procédure M6).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFrame, transit, chooseTransport, LoopbackDirect } = require('../src/direct');

test('direct : remise directe A→B et refus des trames invalides', () => {
  const bus = new LoopbackDirect();
  bus.attach('A');
  bus.attach('B');
  const f = makeFrame({ from: 'A', to: 'B', sealed: 'enveloppe-scellee' });
  bus.send('B', f);
  const [got] = bus.drain('B');
  assert.equal(transit(got, 'B').action, 'deliver');
  assert.throws(() => makeFrame({ from: 'A', to: 'B', sealed: 'x', ttl: 0 }), /ttl/);
});

test('direct : multi-sauts A→B→C avec TTL décrémenté', () => {
  const bus = new LoopbackDirect();
  for (const id of ['A', 'B', 'C']) bus.attach(id);
  const f = makeFrame({ from: 'A', to: 'C', sealed: 'charge', ttl: 3 });
  bus.send('B', f);
  const [atB] = bus.drain('B');
  const hop = transit(atB, 'B');
  assert.equal(hop.action, 'forward');
  assert.equal(hop.frame.ttl, 2);
  assert.deepEqual(hop.frame.visited, ['B']);
  bus.send('C', hop.frame);
  const [atC] = bus.drain('C');
  assert.equal(transit(atC, 'C').action, 'deliver');
});

test('direct : boucle détectée et TTL épuisé rejetés (jamais relayés)', () => {
  assert.throws(() => transit(makeFrame({ from: 'A', to: 'C', sealed: 'x', visited: ['B'] }), 'B'), /direct-loop/);
  assert.throws(() => transit(makeFrame({ from: 'A', to: 'C', sealed: 'x', ttl: 1 }), 'B'), /direct-ttl/);
});

test('direct-native : parsing honnête de la sonde (jamais d\u2019activation)', () => {
  const { parseProbeJson } = require('../src/direct-native');
  const ok = parseProbeJson(JSON.stringify({ v: 1, adapters: [{ name: 'Wi-Fi' }], wifiDirect: 'probable-miracast' }));
  assert.equal(ok.wifiDirect, 'probable-miracast');
  assert.throws(() => parseProbeJson('pas-du-json'), /invalide|Unexpected/);
  assert.throws(() => parseProbeJson(JSON.stringify({ v: 99 })), /invalide/);
});

test('direct : bascule direct si joignable, sinon TCP/IP existant', () => {
  assert.equal(chooseTransport({ id: 'B' }, { directUp: true }), 'direct');
  assert.equal(chooseTransport({ id: 'B' }, { directUp: false }), 'tcp-ip');
  assert.throws(() => chooseTransport(null), /pair requis/);
});

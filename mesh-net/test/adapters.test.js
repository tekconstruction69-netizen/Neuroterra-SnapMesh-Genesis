'use strict';

/**
 * Adaptateurs : statuts honnêtes par plateforme, jamais d'opérationnel
 * théorique. Logique pure (runner injecté), aucune radio touchée.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detect } = require('../src/adapters');

test('adaptateurs : Windows lit le pilote sans conclure à tort', () => {
  const miracast = () => 'Affichage sans fil pris en charge : Oui';
  const a = detect({ platform: 'win32', runner: miracast });
  assert.equal(a.wifiDirect.etat, 'partiel-sonde');
  const confirme = () => 'Wi-Fi Direct Device : Available';
  assert.equal(detect({ platform: 'win32', runner: confirme }).wifiDirect.etat, 'confirme');
  assert.equal(detect({ platform: 'win32', runner: () => { throw new Error('bloqué'); } }).wifiDirect.etat, 'non-verifie');
  assert.equal(detect({ platform: 'win32', runner: miracast }).internet.etat, 'confirme');
});

test('adaptateurs : Linux/macOS/Android/iOS déclarés sans preuve', () => {
  const l = detect({ platform: 'linux', runner: () => 'Wiphy phy0\n\t* P2P-client\n' });
  assert.equal(l.wifiDirect.etat, 'partiel-sonde');
  assert.equal(detect({ platform: 'linux', runner: () => { throw new Error('x'); } }).wifiDirect.etat, 'non-verifie');
  assert.equal(detect({ platform: 'darwin' }).wifiDirect.etat, 'non-verifie');
  assert.equal(detect({ platform: 'android' }).wifiDirect.etat, 'non-verifie');
  const ios = detect({ platform: 'ios' });
  assert.equal(ios.wifiDirect.etat, 'incompatible');
  assert.equal(ios.ble.etat, 'incompatible');
});

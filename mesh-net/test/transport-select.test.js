'use strict';

/**
 * Sélection de transport : priorité, permissions, mesures, bascule.
 * Aucune connexion réelle ici : logique pure sur capacités déclarées.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectTransport } = require('../src/transport-select');

const full = (perm = true) => ({
  direct: { compatible: true, permission: perm },
  'ble-leger': { compatible: true, permission: perm },
  internet: { compatible: true, permission: perm },
});

test('sélection : direct prioritaire si confirmé des deux côtés', () => {
  const r = selectTransport(full(), full(), { internet: { debitMbps: 500 } });
  assert.equal(r.choisi, 'direct');
});

test('sélection : direct écarté sans confirmation bilatérale, BLE jamais pour l\u2019IA', () => {
  const peer = full();
  peer.direct.compatible = false;
  const r = selectTransport(full(), peer);
  assert.equal(r.choisi, 'ble-leger');
  assert.ok(r.candidats.find((c) => c.kind === 'direct' && !c.retenu));
});

test('sélection : permission manquante écarte, aucun transport = null', () => {
  const r = selectTransport(full(false), full(false));
  assert.equal(r.choisi, null);
  assert.ok(r.candidats.every((c) => !c.retenu));
});

test('sélection : la mesure départage internet contre défaut, STOP hors périmètre', () => {
  const local = full();
  local.direct.compatible = false;
  local['ble-leger'].compatible = false;
  const r = selectTransport(local, full(), { internet: { debitMbps: 50, rttMs: 20, stabilite: 0.9 } });
  assert.equal(r.choisi, 'internet');
  assert.equal(r.candidats.find((c) => c.kind === 'internet').mesure, true);
});

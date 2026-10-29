'use strict';

/** P2 : gardes API locale — logique pure, sans sockets. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { MAX_BODY, newToken, originOk, tokenOk } = require('../src/guards');

const req = (headers) => ({ headers });

test('jeton : unique, 48 hex, vérifié strict', () => {
  assert.equal(MAX_BODY, 256 * 1024);
  const a = newToken();
  const b = newToken();
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.notEqual(a, b, 'jetons identiques');
  assert.equal(tokenOk(req({ 'x-genesis-token': a }), a), true);
  assert.equal(tokenOk(req({}), a), false, 'sans jeton accepté');
  assert.equal(tokenOk(req({ 'x-genesis-token': 'faux' }), a), false);
  assert.equal(tokenOk(req({ 'x-genesis-token': '' }), a), false);
  assert.equal(tokenOk(req({ 'x-genesis-token': a }), b), false, 'jeton croisé accepté');
});

test('origin : locale acceptée, tierce refusée', () => {
  const host = '127.0.0.1:48700';
  assert.equal(originOk(req({})), true, 'sans Origin (curl) refusé');
  assert.equal(originOk(req({ origin: `http://${host}`, host })), true);
  assert.equal(originOk(req({ origin: 'http://localhost:48700', host: 'localhost:48700' })), true);
  assert.equal(originOk(req({ origin: 'https://evil.example', host })), false, 'tierce acceptée');
  assert.equal(originOk(req({ origin: 'http://127.0.0.1:9999', host })), false, 'port croisé accepté');
  assert.equal(originOk(req({ origin: 'n-importe-quoi', host })), false);
  assert.equal(originOk(req({ origin: `http://${host}` })), false, 'sans Host accepté');
});

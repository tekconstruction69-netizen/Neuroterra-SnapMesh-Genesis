'use strict';

// Contrat informatif de la jonction : consentement d'abord, aucun
// appairage effectué. L'invocation locale de handler() retourne des
// statusCode ; ce n'est pas une preuve HTTP/HTTPS déployée.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../functions/join');

// Invoque le vrai handler avec un espion fetch : aucun appel réseau
// n'est toléré, et chaque réponse doit porter no-store.
async function invoke(event) {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('réseau interdit dans ce test'); };
  let res;
  try {
    res = await handler(event, {});
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0, 'la jonction ne doit faire aucun appel réseau');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['content-type'], 'application/json');
  return res;
}

test('join : GET refusé en 405', async () => {
  const res = await invoke({ httpMethod: 'GET', body: '' });
  assert.equal(res.statusCode, 405);
});

test('join : JSON malformé refusé en 400', async () => {
  const res = await invoke({ httpMethod: 'POST', body: '{invalide' });
  assert.equal(res.statusCode, 400);
});

test('join : corps null refusé en 400, sans exception', async () => {
  const res = await invoke({ httpMethod: 'POST', body: 'null' });
  assert.equal(res.statusCode, 400);
});

test('join : corps tableau refusé en 400', async () => {
  const res = await invoke({ httpMethod: 'POST', body: '[{"consent":true}]' });
  assert.equal(res.statusCode, 400);
});

test('join : sans consentement explicite, 403 avec procédure', async () => {
  const res = await invoke({ httpMethod: 'POST', body: JSON.stringify({ ntId: 'nt-test' }) });
  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.body);
  assert.equal(typeof body.procedure, 'string');
  assert.ok(body.procedure.length > 0);
});

test('join : consentement + NT-ID, 501 explicite, aucun appairage effectué', async () => {
  const res = await invoke({
    httpMethod: 'POST',
    body: JSON.stringify({ consent: true, ntId: 'nt-test' }),
  });
  assert.equal(res.statusCode, 501);
  const body = JSON.parse(res.body);
  assert.equal(body.etat, 'appairage public non branche');
  assert.match(body.note, /aucun relais public/i);
});

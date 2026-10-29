'use strict';

// Contrat informatif de la passerelle : aucun nœud réel, aucun appel réseau.
// L'invocation locale de handler() retourne statusCode 200 ; ce n'est pas
// une preuve HTTP/HTTPS déployée.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../functions/gateway');

test('gateway : handler réel, scope démonstration-statique, nodesLive null, no-store, sans réseau', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('réseau interdit dans ce test'); };
  try {
    const res = await handler({}, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['content-type'], 'application/json');
    const body = JSON.parse(res.body);
    assert.equal(body.service, 'snapmesh-gateway');
    assert.equal(body.scope, 'demonstration-statique');
    assert.strictEqual(body.nodesLive, null, 'aucun résultat fabriqué : nodesLive doit rester null');
    assert.equal(body.nodes, undefined, 'aucune liste de nœuds fabriquée');
    assert.equal(typeof body.note, 'string');
    assert.ok(body.note.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(globalThis.fetch, originalFetch, 'fetch espion non restauré');
  assert.equal(fetchCalls, 0, 'la passerelle ne doit faire aucun appel réseau');
});

test('gateway : réponse stable et purement informative à chaque invocation', async () => {
  const a = JSON.parse((await handler({}, {})).body);
  const b = JSON.parse((await handler({}, {})).body);
  assert.deepEqual(a, b);
  assert.strictEqual(a.nodesLive, null);
});

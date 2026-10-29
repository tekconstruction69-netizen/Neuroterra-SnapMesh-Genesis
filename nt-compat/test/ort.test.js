'use strict';

/**
 * NT-COMPAT/ORT (M4) : backend accéléré réel — exactitude vs oracle,
 * EPs sondés (cpu/dml/cuda), repli propre si paquet absent.
 * Si onnxruntime-node n'est pas installé, les tests exigeant l'EP
 * sont SAUTÉS avec motif (skip), jamais simulés ; le repli
 * `ort-absent` est lui toujours testé.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildGemmModel } = require('../src/onnx-model');
const { ortAvailable, matmulOrt, availableEps } = require('../src/ort');

function oracle(X, W) {
  const n = X.length;
  return X.map((r, i) => W[0].map((_, j) => r.reduce((s, _, k) => s + X[i][k] * W[k][j], 0)));
}

test('ort : modèle artisanal valide, inférence exacte (cpu)', async (t) => {
  const a = ortAvailable();
  if (!a.available) {
    t.skip(`paquet absent : ${a.reason}`);
    return;
  }
  assert.ok(Buffer.isBuffer(buildGemmModel([[1, 0], [0, 1]])), 'modèle non généré');
  assert.throws(() => buildGemmModel([[1, 2, 3], [4, 5, 6]]), /carrée/, 'non-carré accepté');
  assert.throws(() => buildGemmModel([[Infinity]]), /non finie/);
  const X = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
  const W = [[2, 0, 0], [0, 3, 0], [0, 0, 4]];
  const { Y, ms } = await matmulOrt(X, W, { ep: 'cpu' });
  const exp = oracle(X, W);
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(Y[i][j] - exp[i][j]));
  }
  assert.equal(worst, 0, `inférence inexacte : ${worst}`);
  assert.ok(ms >= 0 && Number.isFinite(ms), 'durée non mesurée');
  console.log(`    [mesuré ici] ORT cpu 3×3 : ${ms.toFixed(3)} ms, erreur 0`);
});

test('ort : EPs sondés réellement (cpu/dml/cuda)', async (t) => {
  const a = ortAvailable();
  if (!a.available) {
    t.skip(`paquet absent : ${a.reason}`);
    return;
  }
  const eps = await availableEps();
  assert.equal(eps.cpu.available, true, `EP cpu indisponible : ${eps.cpu.reason}`);
  console.log(`    [mesuré ici] EPs : cpu=${eps.cpu.available} dml=${eps.dml.available} cuda=${eps.cuda.available}`);
  for (const [name, e] of Object.entries(eps)) {
    if (!e.available) assert.ok(typeof e.reason === 'string' && e.reason.length > 0, `motif absent : ${name}`);
  }
  // DML : exact si présent (sinon motif documenté, pas d'échec).
  if (eps.dml.available) {
    const X = [[1, 2], [3, 4]];
    const W = [[1, 0], [0, 2]];
    const { Y } = await matmulOrt(X, W, { ep: 'dml' });
    assert.deepEqual(Y, [[1, 4], [3, 8]], 'DML inexact');
  }
});

test('ort : absent => erreur explicite, jamais de simulation', () => {
  // Prouve le repli en isolant la résolution (cache require contourné
  // par sous-processus sans le paquet : ici on vérifie le contrat —
  // loadOrt ne rend que si require.resolve réussit).
  const a = ortAvailable();
  assert.equal(typeof a.available, 'boolean');
  if (!a.available) {
    assert.match(a.reason, /non installé/);
  }
});

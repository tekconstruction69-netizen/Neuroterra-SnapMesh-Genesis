'use strict';

/**
 * NT-COMPAT : détection réelle, registre versionné, validateur,
 * tenseurs fp32/int8 (oracles indépendants en JS pur).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { detectBackends } = require('../src/backends');
const { buildRegistry, checkAssignment } = require('../src/registry');
const T = require('../src/tensors');

/** Oracle matmul indépendant (nombres JS, triple boucle naïve). */
function oracle(a, b) {
  const n = a.length;
  const m = b[0].length;
  const p = b.length;
  const out = Array.from({ length: n }, () => Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < p; k++) {
      for (let j = 0; j < m; j++) out[i][j] += a[i][k] * b[k][j];
    }
  }
  return out;
}

test('backends : CPU détecté mesuré, GPU/NPU honnêtement absents', () => {
  const scan = detectBackends({ benchN: 16 });
  // P6 (audit) : aucun backend accéléré sans matériel prouvé.
  assert.deepEqual(scan.acceleratedImplemented, []);
  assert.ok(scan.manualCheck && typeof scan.manualCheck.npu === 'string', 'procédure manuelle absente');
  assert.ok(scan.backends['node-cpu-fp64'].available, 'CPU fp64 absent ?');
  assert.ok(scan.backends['node-cpu-fp64'].flops > 0, 'flops non mesuré');
  assert.ok(scan.backends['node-cpu-fp32'].available);
  assert.ok(scan.backends['node-cpu-int8'].available);
  for (const name of ['cuda', 'directml', 'rocm', 'openvino', 'webgpu', 'webnn', 'onnxruntime']) {
    const b = scan.backends[name];
    assert.ok(b, `backend ${name} non sondé`);
    if (!b.available) assert.ok(typeof b.reason === 'string' && b.reason.length > 5, `motif absent : ${name}`);
  }
});

test('tenseurs fp32 : matmul exact vs oracle, arrondi réel', () => {
  const A = [[0.1, 0.2], [0.3, 0.4]];
  const B = [[1, 2], [3, 4]];
  const r = T.matmul(T.fromArray2D(A, 'fp32'), T.fromArray2D(B, 'fp32'));
  assert.equal(r.dtype, 'fp32');
  assert.ok(r.data instanceof Float32Array, 'pas de Float32Array réel');
  const got = T.toArray2D(r);
  const exp = oracle(A, B);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      assert.ok(Math.abs(got[i][j] - exp[i][j]) < 1e-6, `écart fp32 ${got[i][j]} vs ${exp[i][j]}`);
    }
  }
});

test('tenseurs int8 : zéro exact, erreur de quantification bornée', () => {
  const A = [[1, -2, 0], [0.5, 0, 3]];
  const B = [[2, 0], [1, 1], [-1, 4]];
  const qa = T.quantize(T.fromArray2D(A, 'fp32'));
  assert.equal(qa.dtype, 'int8');
  assert.ok(qa.data instanceof Int8Array);
  // Zéro exact préservé (symétrique autour de 0).
  assert.equal(qa.data[2], 0, 'zéro non préservé');
  const r = T.matmul(qa, T.quantize(T.fromArray2D(B, 'fp32')));
  assert.equal(r.dtype, 'int8acc');
  assert.ok(r.data instanceof Int32Array, 'accumulateur non entier');
  const got = T.toArray2D(r);
  const exp = oracle(A, B);
  let worst = 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) worst = Math.max(worst, Math.abs(got[i][j] - exp[i][j]));
  }
  assert.ok(worst < 0.1, `erreur int8 trop grande : ${worst}`);
});

test('tenseurs : rejets (shapes, dtypes, non-fini, bornes)', () => {
  assert.throws(() => T.fromArray2D([[1], [2, 3]], 'fp32'), /irrégulières/);
  assert.throws(() => T.fromArray2D([[Infinity]], 'fp32'), /non finie/);
  assert.throws(() => T.matmul(T.fromArray2D([[1]], 'fp32'), T.fromArray2D([[1]], 'fp64')), /hétérogènes/);
  assert.throws(() => T.matmul(T.fromArray2D([[1, 2]], 'fp32'), T.fromArray2D([[1]], 'fp32')), /incompatibles/);
  assert.throws(() => T.fromArray2D([[1]], 'bf16'), /inconnu/);
  assert.throws(() => T.fromArray2D([[]], 'fp32'), /1\.\.512/);
});

test('registre + validateur : accepte compatible, refuse motivé', () => {
  const reg = buildRegistry({ detectOpts: { benchN: 8 } });
  assert.equal(reg.v, 1);
  const ok = checkAssignment(reg, {
    id: 't1', op: 'matmul', dtype: 'fp32',
    tensors: [{ shape: [8, 8] }, { shape: [8, 8] }],
  });
  assert.equal(ok.ok, true);
  assert.ok(ok.backend.startsWith('node-cpu'), `backend inattendu : ${ok.backend}`);
  assert.equal(ok.estBytes, 8 * 8 * 4 * 2);
  // dtype sans backend.
  const noDtype = checkAssignment(reg, { id: 't2', op: 'x', dtype: 'fp16', tensors: [{ shape: [2, 2] }] });
  assert.equal(noDtype.ok, false);
  assert.match(noDtype.reason, /aucun backend pour fp16/);
  // backend exigé indisponible.
  const noBe = checkAssignment(reg, { id: 't3', op: 'x', dtype: 'fp32', backend: 'cuda', tensors: [{ shape: [2, 2] }] });
  assert.equal(noBe.ok, false);
  assert.match(noBe.reason, /cuda.*indisponible/);
  // mémoire hors plafond (plafond forcé à 1 Kio : la machine réelle a des Go).
  const small = buildRegistry({ detectOpts: { benchN: 8 }, memCapBytes: 1024 });
  const noMem = checkAssignment(small, { id: 't4', op: 'x', dtype: 'fp32', tensors: [{ shape: [64, 64] }] });
  assert.equal(noMem.ok, false);
  assert.match(noMem.reason, /plafond/);
  // threads, shapes, registre.
  assert.equal(checkAssignment(reg, { id: 't5', op: 'x', dtype: 'fp32', tensors: [{ shape: [2, 2] }], minThreads: 10 ** 9 }).ok, false);
  assert.equal(checkAssignment(reg, { id: 't6', op: 'x', dtype: 'fp32', tensors: [{ shape: [0, 2] }] }).ok, false);
  assert.equal(checkAssignment({ v: 99 }, { id: 't7', dtype: 'fp32', tensors: [{ shape: [2, 2] }] }).ok, false);
  assert.equal(checkAssignment(reg, { id: 't8', op: 'x', dtype: 'fp32', tensors: [{ shape: [2, 2] }], backend: 'node-cpu-fp32' }).ok, true);
});

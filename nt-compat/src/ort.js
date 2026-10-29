'use strict';

/**
 * NT-COMPAT — adaptateur ONNX Runtime (backend `onnxruntime`, P3/M4).
 * Disponible seulement si le paquet `onnxruntime-node` est installé
 * (optionalDependencies) ; sinon `ortAvailable()` = false avec motif
 * et toute inférence lève `ort-absent` (jamais de simulation).
 * `matmulOrt(X, W, {ep})` : Y = X·W fp32, modèle construit en mémoire
 * (jamais de .onnx versionné), session en cache par (n, ep).
 * `availableEps(tinyModel)` : sonde réelle cpu/dml/cuda (création de
 * session, bornée) — coûteux, à n'appeler qu'en test/bench.
 */

const { buildGemmModel } = require('./onnx-model');

function ortAvailable() {
  try {
    require.resolve('onnxruntime-node');
    return { available: true };
  } catch {
    return { available: false, reason: 'paquet onnxruntime-node non installé (optionalDependencies)' };
  }
}

function loadOrt() {
  const a = ortAvailable();
  if (!a.available) {
    const e = new Error(`ort-absent: ${a.reason}`);
    e.code = 'ort-absent';
    throw e;
  }
  return require('onnxruntime-node');
}

const sessions = new Map(); // `${n}:${ep}` -> InferenceSession

async function matmulOrt(X2d, W2d, { ep = 'cpu' } = {}) {
  const ort = loadOrt();
  const n = X2d.length;
  if (!Number.isInteger(n) || n < 1 || n > 256 || X2d[0].length !== n || W2d.length !== n || W2d[0].length !== n) {
    throw new Error(`ort: matrices carrées identiques 1..256 requises`);
  }
  const key = `${n}:${ep}`;
  let s = sessions.get(key);
  if (!s) {
    const model = buildGemmModel(W2d);
    s = await ort.InferenceSession.create(model, { executionProviders: [ep] });
    sessions.set(key, s);
  }
  const flat = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = Number(X2d[i][j]);
      if (!Number.isFinite(v)) throw new Error('ort: valeur non finie');
      flat[i * n + j] = v;
    }
  }
  const t0 = process.hrtime.bigint();
  const out = await s.run({ X: new ort.Tensor('float32', flat, [n, n]) });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const Y = out.Y.data;
  const res = [];
  for (let i = 0; i < n; i++) res.push(Array.from(Y.slice(i * n, (i + 1) * n)));
  return { Y: res, ms };
}

/** Sonde réelle des EP (création de session sur tiny modèle 2×2). */
async function availableEps({ timeoutMs = 15000 } = {}) {
  const ort = loadOrt();
  const model = buildGemmModel([[1, 0], [0, 1]]);
  const eps = {};
  for (const ep of ['cpu', 'dml', 'cuda']) {
    const t0 = process.hrtime.bigint();
    try {
      const s = await ort.InferenceSession.create(model, { executionProviders: [ep] });
      await s.run({ X: new ort.Tensor('float32', Float32Array.from([1, 2, 3, 4]), [2, 2]) });
      eps[ep] = { available: true, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
    } catch (e) {
      eps[ep] = { available: false, reason: String((e && e.message) || e).slice(0, 120) };
    }
    if (Number(process.hrtime.bigint() - t0) / 1e6 > timeoutMs) break;
  }
  return eps;
}

function ortVersion() {
  try {
    return require('onnxruntime-node/package.json').version;
  } catch {
    return null;
  }
}

module.exports = { ortAvailable, loadOrt, matmulOrt, availableEps, ortVersion };

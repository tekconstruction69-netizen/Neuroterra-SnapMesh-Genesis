'use strict';

/**
 * NT-COMPAT — tenseurs réels en JS pur (backends node-cpu-*).
 * - fp32 : Float32Array (arrondi matériel réel).
 * - int8 : quantification symétrique par tenseur (scale = max|v|/127),
 *   matmul entier exact en Int32 puis déquantification.
 * Bornes : dimensions 1..512 (garde-fou mémoire/CPU, cf. validateur).
 */

function assertShape(shape) {
  if (!Array.isArray(shape) || shape.length !== 2) throw new Error('tenseur: shape [lignes, cols] requise');
  const [r, c] = shape;
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 1 || c < 1 || r > 512 || c > 512) {
    throw new Error(`tenseur: dimensions 1..512 (reçu ${r}×${c})`);
  }
  return [r, c];
}

function fromArray2D(a, dtype) {
  const r = a.length;
  if (!Number.isInteger(r) || r < 1 || r > 512) throw new Error('tenseur: lignes 1..512');
  const c = a[0].length;
  const [rr, cc] = assertShape([r, c]);
  if (dtype === 'fp32') {
    const m = new Float32Array(rr * cc);
    for (let i = 0; i < rr; i++) {
      if (!Array.isArray(a[i]) || a[i].length !== cc) throw new Error('tenseur: lignes irrégulières');
      for (let j = 0; j < cc; j++) {
        const v = Number(a[i][j]);
        if (!Number.isFinite(v)) throw new Error('tenseur: valeur non finie');
        m[i * cc + j] = v;
      }
    }
    return { dtype, shape: [rr, cc], data: m };
  }
  if (dtype === 'int8') return quantize(fromArray2D(a, 'fp32'));
  if (dtype === 'fp64') {
    const m = new Float64Array(rr * cc);
    for (let i = 0; i < rr; i++) {
      if (!Array.isArray(a[i]) || a[i].length !== cc) throw new Error('tenseur: lignes irrégulières');
      for (let j = 0; j < cc; j++) {
        const v = Number(a[i][j]);
        if (!Number.isFinite(v)) throw new Error('tenseur: valeur non finie');
        m[i * cc + j] = v;
      }
    }
    return { dtype, shape: [rr, cc], data: m };
  }
  throw new Error(`tenseur: dtype inconnu ${dtype}`);
}

/** Quantification symétrique : max|v| → 127 (zéro exact préservé). */
function quantize(t) {
  if (t.dtype !== 'fp32' && t.dtype !== 'fp64') throw new Error('quantize: entrée flottante requise');
  let peak = 0;
  for (let i = 0; i < t.data.length; i++) {
    const a = Math.abs(t.data[i]);
    if (a > peak) peak = a;
  }
  if (peak === 0) {
    return { dtype: 'int8', shape: [...t.shape], data: new Int8Array(t.data.length), scale: 1 };
  }
  const scale = peak / 127;
  const q = new Int8Array(t.data.length);
  for (let i = 0; i < t.data.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(t.data[i] / scale)));
  return { dtype: 'int8', shape: [...t.shape], data: q, scale };
}

function dequantize(t) {
  if (t.dtype !== 'int8') throw new Error('dequantize: int8 requis');
  const m = new Float32Array(t.data.length);
  for (let i = 0; i < m.length; i++) m[i] = t.data[i] * t.scale;
  return { dtype: 'fp32', shape: [...t.shape], data: m };
}

/** Produit matriciel : fp32/fp64 directs, int8 via accumulateur Int32. */
function matmul(a, b) {
  if (a.dtype !== b.dtype) throw new Error(`matmul: dtypes hétérogènes ${a.dtype} vs ${b.dtype}`);
  const [ar, ac] = a.shape;
  const [br, bc] = b.shape;
  if (ac !== br) throw new Error(`matmul: ${ar}×${ac} · ${br}×${bc} incompatibles`);
  if (a.dtype === 'int8') {
    const acc = new Int32Array(ar * bc);
    for (let i = 0; i < ar; i++) {
      for (let k = 0; k < ac; k++) {
        const av = a.data[i * ac + k];
        for (let j = 0; j < bc; j++) acc[i * bc + j] += av * b.data[k * bc + j];
      }
    }
    return { dtype: 'int8acc', shape: [ar, bc], data: acc, scaleA: a.scale, scaleB: b.scale };
  }
  const Ctor = a.dtype === 'fp32' ? Float32Array : Float64Array;
  const out = new Ctor(ar * bc);
  for (let i = 0; i < ar; i++) {
    for (let k = 0; k < ac; k++) {
      const av = a.data[i * ac + k];
      for (let j = 0; j < bc; j++) out[i * bc + j] += av * b.data[k * bc + j];
    }
  }
  return { dtype: a.dtype, shape: [ar, bc], data: out };
}

/** Ajoute deux tenseurs de même dtype/shape (fp32/fp64). */
function add(a, b) {
  if (a.dtype !== b.dtype || a.dtype === 'int8' || a.dtype === 'int8acc') {
    throw new Error(`add: ${a.dtype}+${b.dtype} non supporté (fp32/fp64 mêmes shapes)`);
  }
  if (a.shape[0] !== b.shape[0] || a.shape[1] !== b.shape[1]) throw new Error('add: shapes différentes');
  const out = new a.data.constructor(a.data.length);
  for (let i = 0; i < out.length; i++) out[i] = a.data[i] + b.data[i];
  return { dtype: a.dtype, shape: [...a.shape], data: out };
}

function toArray2D(t) {
  let m = t;
  let scale = 1;
  if (t.dtype === 'int8') {
    m = dequantize(t);
  } else if (t.dtype === 'int8acc') {
    scale = t.scaleA * t.scaleB;
    m = { shape: t.shape, data: t.data };
  }
  const [r, c] = m.shape;
  const out = [];
  for (let i = 0; i < r; i++) {
    const row = [];
    for (let j = 0; j < c; j++) row.push(m.data[i * c + j] * scale);
    out.push(row);
  }
  return out;
}

function byteSize(t) {
  const per = t.dtype === 'fp64' ? 8 : t.dtype === 'fp32' ? 4 : t.dtype === 'int8' ? 1 : 4;
  return t.data.length * per;
}

module.exports = { fromArray2D, quantize, dequantize, matmul, add, toArray2D, byteSize };

'use strict';

/**
 * Opérations prédéfinies et sûres : les seules qu'un nœud accepte d'exécuter
 * pour un pair. Aucun code arbitraire transmis par le réseau n'est jamais
 * exécuté : l'op est une clé de cette liste blanche, les arguments sont
 * validés (type + bornes) avant exécution. Toutes déterministes.
 */

const crypto = require('node:crypto');

function fail(msg) {
  throw new Error(`args-invalides: ${msg}`);
}

function checkText(v, max) {
  if (typeof v !== 'string') fail('text doit être une chaîne');
  if (v.length > max) fail(`text > ${max} caractères`);
  return v;
}

function checkInt(v, min, max, name) {
  if (!Number.isInteger(v) || v < min || v > max) fail(`${name} entier ${min}..${max}`);
  return v;
}

const OPS = {
  'sha256-hex': {
    describe: 'Empreinte SHA-256 hexadécimale d\'un texte (≤ 4 Ko).',
    validate: (a) => ({ text: checkText(a?.text, 4096) }),
    run: ({ text }) => crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
  },
  wordcount: {
    describe: 'Compte mots/lignes/caractères d\'un texte (≤ 64 Ko).',
    validate: (a) => ({ text: checkText(a?.text, 64 * 1024) }),
    run: ({ text }) => ({
      words: (text.match(/\S+/g) || []).length,
      lines: text.length ? text.split('\n').length : 0,
      chars: text.length,
    }),
  },
  fib: {
    describe: 'Nombre de Fibonacci F(n), n ≤ 40 (entier exact).',
    validate: (a) => ({ n: checkInt(a?.n, 0, 40, 'n') }),
    run: ({ n }) => {
      let x = 0;
      let y = 1;
      for (let i = 0; i < n; i++) [x, y] = [y, x + y];
      return x;
    },
  },
  primes: {
    describe: 'Crible : nombre de premiers ≤ max (max ≤ 200000).',
    validate: (a) => ({ max: checkInt(a?.max, 2, 200000, 'max') }),
    run: ({ max }) => {
      const sieve = new Uint8Array(max + 1);
      let count = 0;
      for (let i = 2; i <= max; i++) {
        if (!sieve[i]) {
          count++;
          for (let j = i * i; j <= max; j += i) sieve[j] = 1;
        }
      }
      return { count };
    },
  },
  'sort-int': {
    describe: 'Tri d\'entiers (≤ 10000 valeurs, |v| ≤ 1e9).',
    validate: (a) => {
      if (!Array.isArray(a?.values) || a.values.length > 10000) fail('values tableau ≤ 10000');
      for (const v of a.values) checkInt(v, -1e9, 1e9, 'élément');
      return { values: a.values.slice() };
    },
    run: ({ values }) => values.sort((p, q) => p - q),
  },
  matmul: {
    describe: 'Produit de matrices carrées ≤ 8x8.',
    validate: (a) => {
      for (const k of ['a', 'b']) {
        if (!Array.isArray(a?.[k]) || a[k].length < 1 || a[k].length > 8) fail(`${k} matrice 1..8`);
        for (const row of a[k]) {
          if (!Array.isArray(row) || row.length !== a[k].length) fail(`${k} doit être carrée`);
          for (const v of row) {
            if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e6) fail('coefficient borné');
          }
        }
      }
      if (a.a.length !== a.b.length) fail('dimensions égales requises');
      return { a: a.a, b: a.b };
    },
    run: ({ a, b }) => {
      const n = a.length;
      const out = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < n; k++) {
          for (let j = 0; j < n; j++) out[i][j] += a[i][k] * b[k][j];
        }
      }
      return out;
    },
  },
};

/**
 * Tenseur d'échange M2 : { m: [[nombres]], dtype: 'fp32'|'int8', scale? }.
 * int8 : entiers -127..127 + scale finie > 0. fp32 : finis, |v| ≤ 1e6.
 * Carré 1..16 (4 Ko max par tenseur — compatible enveloppes).
 */
function checkTensor(t, what) {
  if (!t || typeof t !== 'object' || !Array.isArray(t.m)) fail(`${what} : tenseur {m, dtype} requis`);
  const n = t.m.length;
  if (!Number.isInteger(n) || n < 1 || n > 16) fail(`${what} : carré 1..16`);
  for (const row of t.m) {
    if (!Array.isArray(row) || row.length !== n) fail(`${what} : matrice carrée requise`);
  }
  if (t.dtype === 'int8') {
    if (typeof t.scale !== 'number' || !Number.isFinite(t.scale) || t.scale <= 0 || t.scale > 1e6) {
      fail(`${what} : scale finie > 0 requise (int8)`);
    }
    for (const row of t.m) {
      for (const v of row) {
        if (!Number.isInteger(v) || v < -127 || v > 127) fail(`${what} : int8 -127..127 requis`);
      }
    }
    return { m: t.m.map((r) => r.slice()), dtype: 'int8', scale: t.scale };
  }
  if (t.dtype === 'fp32' || t.dtype === undefined) {
    for (const row of t.m) {
      for (const v of row) {
        if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e6) fail(`${what} : fp32 borné requis`);
      }
    }
    return { m: t.m.map((r) => r.slice()), dtype: 'fp32' };
  }
  fail(`${what} : dtype fp32|int8 requis`);
}

Object.assign(OPS, {
  tmat: {
    describe: 'Produit de tenseurs fp32 carrés ≤ 16x16.',
    validate: (a) => {
      const x = checkTensor(a?.x, 'x');
      const y = checkTensor(a?.y, 'y');
      if (x.dtype !== 'fp32' || y.dtype !== 'fp32') fail('tmat : fp32 uniquement (caster avant)');
      if (x.m.length !== y.m.length) fail('tmat : mêmes dimensions');
      return { x, y };
    },
    run: ({ x, y }) => {
      const n = x.m.length;
      const out = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < n; k++) {
          for (let j = 0; j < n; j++) out[i][j] += x.m[i][k] * y.m[k][j];
        }
      }
      return { m: out, dtype: 'fp32' };
    },
  },
  tadd: {
    describe: 'Somme de tenseurs fp32 carrés ≤ 16x16.',
    validate: (a) => {
      const x = checkTensor(a?.x, 'x');
      const y = checkTensor(a?.y, 'y');
      if (x.dtype !== 'fp32' || y.dtype !== 'fp32') fail('tadd : fp32 uniquement (caster avant)');
      if (x.m.length !== y.m.length) fail('tadd : mêmes dimensions');
      return { x, y };
    },
    run: ({ x, y }) => {
      const n = x.m.length;
      return { m: x.m.map((r, i) => r.map((v, j) => v + y.m[i][j])), dtype: 'fp32' };
    },
  },
  tmati: {
    describe: 'Produit de tenseurs int8 ≤ 16x16, accumulateur entier exact, sortie fp32.',
    validate: (a) => {
      const x = checkTensor(a?.x, 'x');
      const y = checkTensor(a?.y, 'y');
      if (x.dtype !== 'int8' || y.dtype !== 'int8') fail('tmati : int8 uniquement');
      if (x.m.length !== y.m.length) fail('tmati : mêmes dimensions');
      return { x, y };
    },
    run: ({ x, y }) => {
      const n = x.m.length;
      const out = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < n; k++) {
          for (let j = 0; j < n; j++) out[i][j] += x.m[i][k] * y.m[k][j];
        }
      }
      const s = x.scale * y.scale;
      return { m: out.map((r) => r.map((v) => v * s)), dtype: 'fp32' };
    },
  },
  tcast: {
    describe: 'Conversion explicite fp32<->int8 (quantification symétrique, scale mesurée).',
    validate: (a) => {
      const x = checkTensor(a?.x, 'x');
      if (a?.to !== 'int8' && a?.to !== 'fp32') fail('tcast : cible int8|fp32 requise');
      if (x.dtype === a.to) fail('tcast : conversion identité interdite (déjà au format)');
      return { x, to: a.to };
    },
    run: ({ x, to }) => {
      if (to === 'int8') {
        let peak = 0;
        for (const row of x.m) {
          for (const v of row) peak = Math.max(peak, Math.abs(v));
        }
        if (peak === 0) {
          return { m: x.m.map((r) => r.map(() => 0)), dtype: 'int8', scale: 1 };
        }
        const scale = peak / 127;
        return {
          m: x.m.map((r) => r.map((v) => Math.max(-127, Math.min(127, Math.round(v / scale))))),
          dtype: 'int8',
          scale,
        };
      }
      // int8 -> fp32 : déquantification par scale.
      return { m: x.m.map((r) => r.map((v) => v * x.scale)), dtype: 'fp32' };
    },
  },
});

function listOps() {
  return Object.fromEntries(Object.entries(OPS).map(([k, v]) => [k, v.describe]));
}

function runOp(op, args) {
  const def = OPS[op];
  if (!def) throw new Error(`op-inconnue: ${op}`);
  return def.run(def.validate(args));
}

module.exports = { OPS, listOps, runOp };

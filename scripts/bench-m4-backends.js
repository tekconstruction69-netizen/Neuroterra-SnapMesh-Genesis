'use strict';

/**
 * M4 — comparatif backends réels sur la MÊME charge (Gemm fp32 n×n).
 * A : JS Float32Array (node-cpu-fp32). B : ORT EP cpu. C : ORT EP dml.
 * D : NeuroCore preset chain-matmul (bout-en-bout, n=16 — ordre de
 * grandeur, pas même charge : signalé). 5 reps, exactitude vs oracle,
 * EPs + flops mesurés. Réseau réel : NON mesuré ici (sandbox).
 * Usage : node scripts/bench-m4-backends.js --reps 5 [--out ...json]
 */

const { matmulOrt, ortAvailable, availableEps, ortVersion } = require('../nt-compat/src/ort');
const { benchMatmul } = require('../nt-compat/src/backends');

const repsOf = (() => {
  const i = process.argv.indexOf('--reps');
  return i === -1 ? 5 : Math.max(1, Number(process.argv[i + 1]) || 5);
})();
const outOf = (() => {
  const i = process.argv.indexOf('--out');
  return i === -1 ? null : process.argv[i + 1];
})();

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: s[0], med: s[(s.length - 1) >> 1], max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length };
}

async function main() {
  const a = ortAvailable();
  if (!a.available) throw new Error(`ORT requis : ${a.reason}`);
  const eps = await availableEps();
  const arms = {};
  for (const n of [16, 64]) {
    const M = (f) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
    const X = M((i, j) => (i + j) * 0.5);
    const W = M((i, j) => (i === j ? j + 1 : 0));
    const exp = X.map((r, i) => W[0].map((_, j) => r.reduce((s, _, k) => s + X[i][k] * W[k][j], 0)));
    const cell = { n, bras: {} };
    // A : JS.
    {
      const ts = [];
      for (let r = 0; r < repsOf; r++) ts.push(benchMatmul(n, true).ms);
      cell.bras.A = { backend: 'node-cpu-fp32 (JS)', ms: stats(ts) };
    }
    // B/C : ORT cpu/dml (si dispo).
    for (const [key, ep] of [['B', 'cpu'], ['C', 'dml']]) {
      if (!eps[ep].available) {
        cell.bras[key] = { backend: `ort-${ep}`, indisponible: eps[ep].reason };
        continue;
      }
      await matmulOrt(X, W, { ep }); // warmup (session + caches)
      const ts = [];
      let worst = 0;
      for (let r = 0; r < repsOf; r++) {
        const { Y, ms } = await matmulOrt(X, W, { ep });
        ts.push(ms);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) worst = Math.max(worst, Math.abs(Y[i][j] - exp[i][j]));
        }
      }
      cell.bras[key] = { backend: `ort-${ep}`, ms: stats(ts), erreurMax: worst };
    }
    (arms[n] = cell);
  }
  const report = {
    module: 'M4-backends',
    date: new Date().toISOString(),
    node: process.version,
    ort: ortVersion(),
    eps,
    reps: repsOf,
    limites: 'CPU Ryzen 7 7435HS, iGPU via DirectML ; cuda absent ; réseau non mesuré',
    resultats: arms,
  };
  for (const [n, cell] of Object.entries(arms)) {
    const f = (b) => (b.ms ? `${b.ms.med.toFixed(3)} ms (err ${b.erreurMax})` : `INDISPONIBLE (${b.indisponible})`);
    console.log(`n=${n} : A-JS ${cell.bras.A.ms.med.toFixed(3)} ms | B-ort-cpu ${f(cell.bras.B)} | C-ort-dml ${f(cell.bras.C)}`);
  }
  const fs = require('node:fs');
  if (outOf) {
    fs.writeFileSync(outOf, JSON.stringify(report, null, 2));
    console.log(`rapport : ${outOf}`);
  } else {
    console.log(JSON.stringify(report));
  }
}

main().catch((e) => {
  console.error('bench-m4:', e.message);
  process.exit(1);
});

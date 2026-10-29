'use strict';

/**
 * Expériences NT-FUSION §7 (M7) : A-E sur graphe réel, workers locaux.
 * A : 1 worker, exécution directe.
 * B : 2 workers, plan round-robin (repli déterministe).
 * C : 2 workers, plan greedy capacités (flops mesurés).
 * D : 2 workers, plan Muse-repli (sans clé : greedy-fallback validé).
 * E : D + NT-Flux (transferts inter-workers packés réellement).
 * Mesuré : temps total (médiane reps), octets transférés, mémoire max
 * observée, taux de réussite, récupération après panne injectée.
 * Limites : workers = 2 registres de CETTE machine (processus locaux,
 * pas 2 appareils) ; transport = comptage d'octets (fil réel : §5/e2e).
 * Usage : node scripts/bench-ntfusion.js --reps 5 [--out bench-logs/...json]
 */

const { buildRegistry } = require('../nt-compat/src/registry');
const { executeGraph } = require('../nt-fusion/src/execute');
const { planGreedy, validatePlan } = require('../nt-fusion/src/planner');
const { buildFusionInput, proposeFusionPlans, fallbackPlans } = require('../nt-fusion/src/muse');
const { pack } = require('../mesh-flux/src/flux');
const { tensorBytes } = require('../nt-fusion/src/graph');

const repsOf = (() => {
  const i = process.argv.indexOf('--reps');
  return i === -1 ? 5 : Math.max(1, Number(process.argv[i + 1]) || 5);
})();
const outOf = (() => {
  const i = process.argv.indexOf('--out');
  return i === -1 ? null : process.argv[i + 1];
})();

/** Graphe : (A×B) fp32 32×32 → cast int8 → ×C int8 → cast fp32 → +D. */
function workload() {
  const mat = (n, f) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
  return {
    v: 1,
    nodes: [
      { id: 'A', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(32, (i, j) => (i + j) * 0.5) } },
      { id: 'B', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(32, (i, j) => (i - j) * 0.25) } },
      { id: 'mm', kind: 'matmul', dtype: 'fp32', deps: ['A', 'B'], in: { a: { $node: 'A' }, b: { $node: 'B' } } },
      { id: 'qi', kind: 'cast', dtype: 'int8', deps: ['mm'], in: { x: { $node: 'mm' } } },
      { id: 'C', kind: 'input', dtype: 'int8', deps: [], params: { values: mat(32, (i, j) => ((i + j) % 5) - 2) } },
      { id: 'mm2', kind: 'matmul', dtype: 'int8', deps: ['qi', 'C'], in: { a: { $node: 'qi' }, b: { $node: 'C' } } },
      { id: 'qf', kind: 'cast', dtype: 'fp32', deps: ['mm2'], in: { x: { $node: 'mm2' } } },
      { id: 'D', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(32, () => 1) } },
      { id: 'out', kind: 'add', dtype: 'fp32', deps: ['qf', 'D'], in: { a: { $node: 'qf' }, b: { $node: 'D' } } },
    ],
  };
}

function mkWorkers() {
  return [
    { id: 'w1', registry: buildRegistry({ detectOpts: { benchN: 16 } }) },
    { id: 'w2', registry: buildRegistry({ detectOpts: { benchN: 16 } }) },
  ];
}

/** Octets transférés d'un plan (sommes des jambes inter-workers). */
function transferBytes(plan) {
  return (plan.transfers || []).reduce((t, l) => t + l.bytes, 0);
}

/** Octets après NT-Flux : pack RÉEL des octets des tenseurs transférés. */
function fluxBytes(plan, values) {
  let total = 0;
  const codecMix = {};
  for (const l of plan.transfers || []) {
    const t = values.get(l.node);
    if (!t) throw new Error(`fluxBytes: valeur manquante ${l.node}`);
    const raw = Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength);
    const env = pack(raw, { effort: 'normal' });
    total += env.codec === 'raw' ? raw.length : JSON.stringify(env).length;
    codecMix[env.codec] = (codecMix[env.codec] || 0) + 1;
  }
  return { total, codecMix };
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: s[0], med: s[(s.length - 1) >> 1], max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length };
}

async function main() {
  const g = workload();
  const mem0 = process.memoryUsage().heapUsed;
  let memPeak = mem0;
  const sample = () => {
    const h = process.memoryUsage().heapUsed;
    if (h > memPeak) memPeak = h;
  };
  const arms = {};
  // A : local direct.
  {
    const ts = [];
    let ok = 0;
    for (let r = 0; r < repsOf; r++) {
      const t0 = process.hrtime.bigint();
      try {
        await executeGraph(g);
        ok++;
      } catch {}
      ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
      sample();
    }
    arms.A = { strategie: '1 worker local', tempsMs: stats(ts), reussite: `${ok}/${repsOf}`, transfertsOctets: 0 };
  }
  const workers = mkWorkers();
  // B : round-robin.
  const rrPlan = fallbackPlans(null, g, workers).plans.find((p) => p.strategy === 'round-robin-fallback');
  // C : greedy capacités.
  const greedyPlan = planGreedy(g, workers);
  // D : Muse-repli (sans clé).
  const input = buildFusionInput({ graph: g, workers });
  const museRes = await proposeFusionPlans(input, g, workers);
  const musePlan = museRes.plans[0];
  for (const [name, plan] of [['B', rrPlan], ['C', greedyPlan], ['D', musePlan]]) {
    const v = validatePlan(g, plan, workers);
    if (!v.ok) throw new Error(`plan ${name} invalide : ${v.reason}`);
    const ts = [];
    let ok = 0;
    for (let r = 0; r < repsOf; r++) {
      const t0 = process.hrtime.bigint();
      try {
        await executeGraph(g, { plan });
        ok++;
      } catch {}
      ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
      sample();
    }
    arms[name] = {
      strategie: name === 'B' ? 'round-robin 2 workers' : name === 'C' ? 'greedy capacités' : `muse-repli (${museRes.provider})`,
      tempsMs: stats(ts), reussite: `${ok}/${repsOf}`,
      transfertsOctets: transferBytes(plan), placements: plan.assignments,
    };
  }
  // E : plan qui transfère (round-robin) + NT-Flux réel sur les jambes.
  // (D/greedy place tout en local quand les workers sont équivalents :
  // 0 transfert = décision optimale, rien à compresser.)
  {
    // Une exécution de référence fournit les tenseurs réellement transférés.
    const ref = await executeGraph(g, { plan: rrPlan });
    const f = fluxBytes(rrPlan, ref.values);
    arms.E = {
      strategie: 'round-robin + NT-Flux',
      tempsMs: arms.B.tempsMs, reussite: arms.B.reussite,
      transfertsOctets: arms.B.transfertsOctets, transfertsFluxOctets: f.total, codecs: f.codecMix,
      placements: rrPlan.assignments,
    };
  }
  // Récupération : panne injectée une fois sur mm2 (retryMax 1) → doit réussir.
  const gFail = workload();
  gFail.nodes.find((n) => n.id === 'mm2').retryMax = 1;
  let recovered = false;
  let failedOnce = false;
  try {
    await executeGraph(gFail, { hooks: { onNode: async (id) => { if (id === 'mm2' && !failedOnce) { failedOnce = true; throw new Error('panne-injectée'); } } } });
    recovered = true;
  } catch {}
  const report = {
    module: 'NT-FUSION',
    date: new Date().toISOString(),
    node: process.version,
    plateforme: process.platform,
    reps: repsOf,
    limites: 'workers = 2 registres de cette machine (processus locaux) ; transferts = octets comptés (fil réel : §5/e2e) ; Muse live non appelé (aucune clé)',
    bras: arms,
    recuperationPanne: recovered ? 'OK (retry mm2)' : 'ÉCHEC',
    memoireMaxObserveeOctets: memPeak - mem0,
  };
  for (const [k, a] of Object.entries(arms)) {
    const extra = a.transfertsFluxOctets !== undefined ? ` → flux ${a.transfertsFluxOctets} o ${JSON.stringify(a.codecs)}` : '';
    console.log(`${k} ${a.strategie} : ${a.reussite} méd ${a.tempsMs.med.toFixed(2)} ms, transferts ${a.transfertsOctets} o${extra}`);
  }
  console.log(`récupération : ${report.recuperationPanne}, mémoire +${report.memoireMaxObserveeOctets} o`);
  const fs = require('node:fs');
  if (outOf) {
    fs.writeFileSync(outOf, JSON.stringify(report, null, 2));
    console.log(`rapport : ${outOf}`);
  } else {
    console.log(JSON.stringify(report));
  }
}

main().catch((e) => {
  console.error('bench-ntfusion:', e.message);
  process.exit(1);
});

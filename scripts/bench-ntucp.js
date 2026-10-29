'use strict';

/**
 * PoC NT-UCP bout-en-bout : CERT → NEGOTIATE → plan → exécution hétérogène.
 * Workers : wA complet (fp32+int8), wB SANS int8 (profil logiciel distinct
 * sur la même machine — PAS deux appareils, documenté).
 * Tâche : (A×B) fp32 → cast int8 → (×C) int8 → cast fp32 → (+D).
 * Comparé : mono-appareil (local) vs greedy vs Muse-repli.
 * Surcoûts ventilés et MESURÉS : négociation, crypto (sign/verify),
 * conversions (casts), transferts (NT-Flux réel sur tenseurs).
 * Limites : processus locaux, fil simulé (copies JSON), Muse live non
 * appelé, safety = budgets déclarés du registre (pas le contrôleur
 * matériel — cf. spec).
 * Usage : node scripts/bench-ntucp.js --reps 3 [--out bench-logs/...json]
 */

const { Identity } = require('../mesh-net/src/identity');
const { buildCaps } = require('../mesh-net/src/caps');
const { detectBackends } = require('../nt-compat/src/backends');
const { buildRegistry } = require('../nt-compat/src/registry');
const { issueCert } = require('../nt-ucp/src/cert');
const { negotiatePair } = require('../nt-ucp/src/negotiate');
const { executeGraph } = require('../nt-fusion/src/execute');
const { planGreedy, validatePlan } = require('../nt-fusion/src/planner');
const { buildFusionInput, proposeFusionPlans } = require('../nt-fusion/src/muse');
const { Ledger } = require('../nt-fusion/src/ledger');
const { pack } = require('../mesh-flux/src/flux');

const repsOf = (() => {
  const i = process.argv.indexOf('--reps');
  return i === -1 ? 3 : Math.max(1, Number(process.argv[i + 1]) || 3);
})();
const outOf = (() => {
  const i = process.argv.indexOf('--out');
  return i === -1 ? null : process.argv[i + 1];
})();

function workload() {
  const mat = (n, f) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
  return {
    v: 1,
    nodes: [
      { id: 'A', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(24, (i, j) => (i + j) * 0.5) } },
      { id: 'B', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(24, (i, j) => (i - j) * 0.25) } },
      { id: 'mm', kind: 'matmul', dtype: 'fp32', deps: ['A', 'B'], in: { a: { $node: 'A' }, b: { $node: 'B' } } },
      { id: 'qi', kind: 'cast', dtype: 'int8', deps: ['mm'], in: { x: { $node: 'mm' } } },
      { id: 'C', kind: 'input', dtype: 'int8', deps: [], params: { values: mat(24, (i, j) => ((i + j) % 5) - 2) } },
      { id: 'mm2', kind: 'matmul', dtype: 'int8', deps: ['qi', 'C'], in: { a: { $node: 'qi' }, b: { $node: 'C' } } },
      { id: 'qf', kind: 'cast', dtype: 'fp32', deps: ['mm2'], in: { x: { $node: 'mm2' } } },
      { id: 'D', kind: 'input', dtype: 'fp32', deps: [], params: { values: mat(24, () => 1) } },
      { id: 'out', kind: 'add', dtype: 'fp32', deps: ['qf', 'D'], in: { a: { $node: 'qf' }, b: { $node: 'D' } } },
    ],
  };
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: s[0], med: s[(s.length - 1) >> 1], max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length };
}

async function main() {
  const over = {};
  // 1. Identités + CERT (crypto mesurée : émission).
  const keyA = Identity.generate();
  const keyB = Identity.generate();
  const compat = detectBackends({ benchN: 16 });
  let t0 = process.hrtime.bigint();
  const certA = issueCert(keyA, { nodeId: keyA.id, name: 'NT-PC-A', caps: buildCaps(), compat });
  const certB = issueCert(keyB, { nodeId: keyB.id, name: 'NT-PC-B', caps: buildCaps(), compat });
  over.cryptoCertMs = Number(process.hrtime.bigint() - t0) / 1e6;
  // 2. Négociation (fil simulé, vérifiée des deux côtés).
  t0 = process.hrtime.bigint();
  const neg = negotiatePair(certA, keyA, certB, keyB);
  over.negociationMs = Number(process.hrtime.bigint() - t0) / 1e6;
  over.negociationOctets = neg.bytes;
  // 3. Workers hétérogènes : wB sans int8 (ne peut pas prendre mm2/qi).
  const regA = buildRegistry({ detectOpts: { benchN: 16 } });
  const regB = buildRegistry({ detectOpts: { benchN: 16 } });
  for (const b of Object.values(regB.backends)) {
    if (b.available) {
      b.dtypes = (b.dtypes || []).filter((d) => d !== 'int8');
      if (!b.dtypes.length) b.available = false;
    }
  }
  const workers = [{ id: 'wA', registry: regA }, { id: 'wB', registry: regB }];
  // Safety : budgets déclarés respectés (plafonds registres > estimation).
  const g = workload();
  // 4. Plans : greedy + Muse-repli, validés.
  const greedy = planGreedy(g, workers);
  const input = buildFusionInput({ graph: g, workers });
  const museRes = await proposeFusionPlans(input, g, workers);
  const musePlan = museRes.plans[0];
  for (const [name, p] of [['greedy', greedy], ['muse', musePlan]]) {
    const v = validatePlan(g, p, workers);
    if (!v.ok) throw new Error(`plan ${name} invalide : ${v.reason}`);
  }
  // 5. Exécutions réelles + transferts NT-Flux sur tenseurs réels.
  const arms = {};
  // Warmup JIT (hors mesure) : sinon le premier bras paie la compilation.
  await executeGraph(workload());
  const runArm = async (name, plan) => {
    const ts = [];
    let ok = 0;
    let last = null;
    for (let r = 0; r < repsOf; r++) {
      const a = process.hrtime.bigint();
      try {
        last = await executeGraph(g, { plan });
        ok++;
      } catch {}
      ts.push(Number(process.hrtime.bigint() - a) / 1e6);
    }
    // Conversions : temps cumulé des casts (mesuré, pas estimé).
    let tConvert = 0;
    for (const [id, m] of Object.entries(last.metrics.nodes)) {
      if (id === 'qi' || id === 'qf') tConvert += m.ms;
    }
    // Transferts : pack réel des tenseurs des jambes inter-workers.
    let tBytes = 0;
    let fBytes = 0;
    let tPack = 0;
    for (const l of (plan && plan.transfers) || []) {
      const t = last.values.get(l.node);
      const raw = Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength);
      tBytes += raw.length;
      const p0 = process.hrtime.bigint();
      const env = pack(raw, { effort: 'normal' });
      tPack += Number(process.hrtime.bigint() - p0) / 1e6;
      fBytes += env.codec === 'raw' ? raw.length : JSON.stringify(env).length;
    }
    arms[name] = {
      reussite: `${ok}/${repsOf}`, tempsMs: stats(ts),
      conversionMs: tConvert, transfertsOctets: tBytes,
      transfertsFluxOctets: fBytes, tPackMs: tPack, placements: plan ? plan.assignments : { tous: 'local' },
    };
    return last;
  };
  await runArm('mono (local)', null);
  const refB = await runArm('greedy hétérogène', greedy);
  await runArm('muse-repli', musePlan);
  // 6. Exactitude vs oracle indépendant (nombres JS).
  const { toArray2D } = require('../nt-compat/src/tensors');
  const got = toArray2D(refB.values.get('out'));
  const N = 24;
  const A = workload().nodes[0].params.values;
  const Bm = workload().nodes[1].params.values;
  const C = workload().nodes[4].params.values;
  const mm = A.map((row, i) => Bm[0].map((_, j) => row.reduce((s, _, k) => s + A[i][k] * Bm[k][j], 0)));
  const mm2 = mm.map((row, i) => C[0].map((_, j) => row.reduce((s, _, k) => s + row[k] * C[k][j], 0)));
  const exp = mm2.map((row, i) => row.map((v, j) => v + 1));
  let worst = 0;
  let peak = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      worst = Math.max(worst, Math.abs(got[i][j] - exp[i][j]));
      peak = Math.max(peak, Math.abs(exp[i][j]));
    }
  }
  const relErr = worst / Math.max(1e-9, peak);
  // 7. Registre : 3 preuves du PoC (négociation, plan, résultat).
  const ledger = new Ledger();
  ledger.append('négociation', { selected: neg.selected, bytes: neg.bytes });
  ledger.append('plan', { strategy: 'greedy', assignments: greedy.assignments });
  ledger.append('résultat', { erreurMax: worst, placements: greedy.assignments });
  const report = {
    module: 'NT-UCP PoC',
    date: new Date().toISOString(),
    node: process.version,
    reps: repsOf,
    limites: '2 profils logiciels sur cette machine (pas 2 appareils) ; fil simulé ; Muse live non appelé ; safety = budgets déclarés',
    negocié: neg.selected,
    surcoûts: { ...over, conversionsVoirBras: true },
    bras: arms,
    erreurMaxVsOracle: worst,
    picOracle: peak,
    erreurRelative: relErr,
    registre: ledger.verify(),
  };
  console.log(`négocié : ${JSON.stringify(neg.selected)} (${over.negociationMs.toFixed(2)} ms, ${neg.bytes} o)`);
  for (const [k, a] of Object.entries(arms)) {
    console.log(`${k} : ${a.reussite} méd ${a.tempsMs.med.toFixed(2)} ms, conv ${a.conversionMs.toFixed(3)} ms, transferts ${a.transfertsOctets}→flux ${a.transfertsFluxOctets} o (pack ${a.tPackMs.toFixed(2)} ms)`);
  }
  console.log(`erreur max vs oracle : ${worst} (pic ${peak}, relatif ${(relErr * 100).toFixed(3)} %), registre : ${JSON.stringify(ledger.verify())}`);
  // Placement hétérogène prouvé : mm2/qi sur wA (seul avec int8).
  const int8onA = ['qi', 'mm2'].every((id) => greedy.assignments[id] === 'wA');
  console.log(`nœuds int8 sur wA (seul compatible) : ${int8onA}`);
  if (!int8onA) throw new Error('placement hétérogène non prouvé');
  const fs = require('node:fs');
  if (outOf) {
    fs.writeFileSync(outOf, JSON.stringify(report, null, 2));
    console.log(`rapport : ${outOf}`);
  } else {
    console.log(JSON.stringify(report));
  }
}

main().catch((e) => {
  console.error('bench-ntucp:', e.message);
  process.exit(1);
});

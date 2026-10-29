'use strict';

/**
 * Bench NT-ADAPT : B0 local / B1 round-robin / B2 NeuroCore actuel / B3 NT-ADAPT.
 * Protocole figé (benchmark-lab) : reps ≥ 5 (défaut 7), graphes déterministes
 * (presets, aucune graine aléatoire), journal brut JSON versionné.
 *
 * Portée honnête : exécution = processus local (executeGraph), fil = octets
 * COMPTÉS (pas de sockets). Les asymétries (flops ×8, lien 256 Kio/s, plafond
 * mémoire) sont ÉMULÉES sur les registres et étiquetées comme telles : elles
 * éprouvent la DÉCISION. Les temps d'exécution locaux (sub-ms) ne prouvent
 * aucun gain réseau ; l'endpoint primaire est le makespan ESTIMÉ du modèle
 * (chemin critique) + octets + faisabilité, l'exécution prouve l'exactitude.
 *
 * Usage : node scripts/bench-ntadapt.js [--reps 7] [--out bench-logs/ntadapt-....json]
 */

const fs = require('node:fs');
const os = require('node:os');
const { buildRegistry } = require('../nt-compat/src/registry');
const { executeGraph } = require('../nt-fusion/src/execute');
const { planGreedy } = require('../nt-fusion/src/planner');
const { validatePlan } = require('../nt-fusion/src/planner');
const { inferShapes, tensorBytes } = require('../nt-fusion/src/graph');
const { toArray2D } = require('../nt-compat/src/tensors');
const { NeuroCore, buildPreset } = require('../neurocore/src/flow');
const { planAdapt, planRoundRobin, verifyTolerance, probeWorker, seedLearnerFromProbe, measureLegWire } = require('../neurocore/src/adapt');
const { Learner } = require('../neurocore/src/learn');

/** Apprenant amorcé par épreuves réelles (chemin NT-ADAPT complet). */
function seededLearner(workers) {
  const l = new Learner();
  for (const w of workers) seedLearnerFromProbe(l, probeWorker(w, { n: 32, reps: 3 }));
  return l;
}

const repsArg = (() => { const i = process.argv.indexOf('--reps'); return i === -1 ? 7 : Math.max(5, Number(process.argv[i + 1]) || 7); })();
const outArg = (() => { const i = process.argv.indexOf('--out'); return i === -1 ? null : process.argv[i + 1]; })();

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  return { n: s.length, min: +s[0].toFixed(4), med: +s[(s.length - 1) >> 1].toFixed(4), max: +s[s.length - 1].toFixed(4), mean: +mean.toFixed(4), sd: +sd.toFixed(4) };
}

function registry({ flopFactor = 1, noInt8 = false, capBytes = null } = {}) {
  const r = buildRegistry({ detectOpts: { benchN: 16 } });
  for (const b of Object.values(r.backends)) {
    if (b.available && Number.isFinite(b.flops)) b.flops = Math.round(b.flops * flopFactor);
    if (noInt8 && b.available) {
      b.dtypes = (b.dtypes || []).filter((d) => d !== 'int8');
      if (!b.dtypes.length) b.available = false;
    }
  }
  if (capBytes !== null) r.mem.capBytes = capBytes;
  return r;
}

const SLOW = { 'wB->wA': 256 * 1024, 'wA->wB': 256 * 1024 };

function cumulativeOk(graph, plan, workers) {
  const shapes = inferShapes(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const per = {};
  for (const n of graph.nodes) {
    const wid = plan.assignments[n.id];
    per[wid] = (per[wid] || 0) + tensorBytes(shapes.get(n.id), byId.get(n.id).dtype);
  }
  const caps = Object.fromEntries(workers.map((w) => [w.id, w.registry.mem.capBytes]));
  return { ok: Object.entries(per).every(([wid, b]) => b <= caps[wid]), perWorkerBytes: per };
}

async function runArm(name, graph, workers, makePlan) {
  // Temps de planification (médiane sur reps appels, décision déterministe).
  const planTimes = [];
  let plan = null;
  let planError = null;
  for (let r = 0; r < repsArg; r++) {
    const t0 = process.hrtime.bigint();
    try { plan = makePlan(); } catch (e) { planError = e.message; }
    planTimes.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  if (!plan) return { strategie: name, faisable: false, raison: planError, planMs: stats(planTimes) };
  const valid = validatePlan(graph, plan, workers);
  const cum = cumulativeOk(graph, plan, workers);
  const transferBytes = (plan.transfers || []).reduce((s, l) => s + l.bytes, 0);
  const execTimes = [];
  let result = null;
  let execError = null;
  for (let r = 0; r < repsArg; r++) {
    const t0 = process.hrtime.bigint();
    try {
      const out = await executeGraph(graph, { plan });
      result = toArray2D(out.values.get([...out.values.keys()].pop()));
    } catch (e) { execError = e.message; }
    execTimes.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return {
    strategie: name, faisable: valid.ok && cum.ok, planValide: valid.ok,
    raisonInvalide: valid.ok ? null : valid.reason, memoireCumulativeOk: cum.ok,
    perWorkerBytes: cum.perWorkerBytes, assignments: plan.assignments,
    transfertsOctets: transferBytes, estMsModele: plan.estMs !== null && plan.estMs !== undefined ? +Number(plan.estMs).toFixed(4) : null,
    planMs: stats(planTimes), execMs: stats(execTimes), execErreur: execError, _result: result,
  };
}

async function main() {
  const scenarios = [];
  // S1 : chaîne mixte, wB fp32 rapide émulé sans int8, lien lent émulé.
  {
    const graph = buildPreset('mixed-fp32-int8', { n: 32 });
    const workers = [
      { id: 'wA', registry: registry({}) },
      { id: 'wB', registry: registry({ flopFactor: 8, noInt8: true }) },
    ];
    const arms = {};
    arms.B0 = await runArm('local mono (meilleur worker seul)', graph, workers,
      () => ({ v: 1, strategy: 'local', assignments: Object.fromEntries(graph.nodes.map((n) => [n.id, 'wA'])), transfers: [], estMs: null }));
    arms.B1 = await runArm('round-robin aveugle', graph, workers, () => planRoundRobin(graph, workers));
    arms.B2 = await runArm('NeuroCore actuel (glouton appris)', graph, workers,
      () => new NeuroCore({ workers }).plan(graph));
    let b3 = null;
    const learnerB3 = seededLearner(workers);
    arms.B3 = await runArm('NT-ADAPT (global pessimiste + épreuves)', graph, workers,
      () => { b3 = planAdapt(graph, workers, { netBps: SLOW, learner: learnerB3 }); return b3.plan; });
    // B2 avec le même lien lent connu (variante documentée, greedy nt-fusion).
    arms.B2g = await runArm('greedy nt-fusion (lien lent connu)', graph, workers,
      () => planGreedy(graph, workers, { netBps: SLOW }));
    // Exactitude : chaque bras faisable vs référence B0 (même moteur, tolérance fp32).
    const ref = arms.B0._result;
    for (const a of Object.values(arms)) {
      if (a._result && ref) a.exactitudeVsB0 = verifyTolerance(a._result, ref, { rtol: 1e-4, atol: 1e-6 });
      delete a._result;
    }
    if (b3) arms.B3.adaptDetail = { evaluated: b3.evaluated, rejected: b3.rejected, searchMode: b3.searchMode, reason: b3.reason, bestSingleMs: b3.bestSingleMs, bestDistributedMs: b3.bestDistributedMs };
    scenarios.push({ id: 'S1-chaine-mixte-lien-lent', etiquette: 'asymétrie ÉMULÉE (flops×8, lien 256 Kio/s, wB sans int8)', graph: 'mixed-fp32-int8 n=32', bras: arms });
  }
  // S2 : symétrique rapide — le distribué ne doit pas être forcé.
  {
    const graph = buildPreset('mixed-fp32-int8', { n: 16 });
    const workers = [{ id: 'wA', registry: registry({}) }, { id: 'wB', registry: registry({}) }];
    const arms = {};
    const learnerS2 = seededLearner(workers);
    arms.B3 = await runArm('NT-ADAPT (global pessimiste + épreuves)', graph, workers, () => planAdapt(graph, workers, { learner: learnerS2 }).plan);
    scenarios.push({ id: 'S2-symetrique', etiquette: 'workers identiques, lien défaut loopback documenté', graph: 'mixed-fp32-int8 n=16', bras: arms });
  }
  // S3 : mémoire cumulée — batch parallèle, plafond émulé 6000 o.
  {
    const graph = buildPreset('batch-add', { n: 16 });
    const workers = [
      { id: 'wA', registry: registry({ capBytes: 6000 }) },
      { id: 'wB', registry: registry({ capBytes: 6000 }) },
    ];
    const arms = {};
    arms.B2 = await runArm('NeuroCore actuel (glouton appris)', graph, workers, () => new NeuroCore({ workers }).plan(graph));
    const learnerS3 = seededLearner(workers);
    arms.B3 = await runArm('NT-ADAPT (global pessimiste + épreuves)', graph, workers, () => planAdapt(graph, workers, { learner: learnerS3 }).plan);
    for (const a of Object.values(arms)) delete a._result;
    scenarios.push({ id: 'S3-memoire-cumulee', etiquette: 'plafond ÉMULÉ 6000 o/worker (nœud=1024 o, mono=7168 o)', graph: 'batch-add n=16', bras: arms });
  }
  // Micro-benchmarks : épreuve réelle + compression au bénéfice net.
  const probeWorkers = [
    { id: 'wA', registry: registry({}) },
    { id: 'wB', registry: registry({ flopFactor: 8, noInt8: true }) },
  ];
  const report = {
    module: 'NT-ADAPT', date: new Date().toISOString(), node: process.version,
    plateforme: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length,
    reps: repsArg, protocole: 'presets déterministes; endpoint primaire = makespan modèle + octets + faisabilité; exécution locale = exactitude seulement',
    limites: '1 machine, processus locaux; fil COMPTÉ (pas de sockets); asymétries ÉMULÉES sur registres; énergie NON mesurée (null); 2 appareils NON exécutés',
    scenarios,
    epreuves: probeWorkers.map((w) => probeWorker(w, { n: 32, reps: 3 })),
    compressionMesuree: {
      repetitif64K_lien1Mio: measureLegWire(Buffer.alloc(65536, 7), { bps: 1 * 1024 * 1024 }),
      aleatoire64K_lien1Mio: measureLegWire(require('node:crypto').randomBytes(65536), { bps: 1 * 1024 * 1024 }),
    },
  };
  for (const s of scenarios) {
    console.log(`\n== ${s.id} (${s.graph}) — ${s.etiquette}`);
    for (const [k, a] of Object.entries(s.bras)) {
      console.log(`${k} ${a.strategie} : faisable=${a.faisable} transferts=${a.transfertsOctets !== undefined ? a.transfertsOctets : '?'} o estModele=${a.estMsModele} ms planMed=${a.planMs ? a.planMs.med : '?'} ms execMed=${a.execMs ? a.execMs.med : 'n/a'} ms`);
    }
  }
  console.log('\n== épreuves (mesurées, même processus)');
  for (const p of report.epreuves) console.log(`${p.workerId} matmul-fp32 ${p.ops.matmul_fp32.ms} ms errMax ${p.ops.matmul_fp32.maxErrVsFp64.toExponential(2)} hash ${p.hash.slice(0, 12)}…`);
  console.log(`compression répétitif: ${JSON.stringify(report.compressionMesuree.repetitif64K_lien1Mio)}`);
  console.log(`compression aléatoire: ${JSON.stringify(report.compressionMesuree.aleatoire64K_lien1Mio)}`);
  const out = outArg || `bench-logs/ntadapt-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nrapport brut : ${out}`);
}

main().catch((e) => { console.error('bench-ntadapt:', e.message); process.exit(1); });

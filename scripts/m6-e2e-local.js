'use strict';

/**
 * M6 — scénario bout-en-bout MÊME HÔTE (étiqueté, pas multi-appareils).
 * Chaîne : soumission (requête JSON) → épreuves + sélection NT-ADAPT →
 * exécution (graphe réel + inférence ONNX Runtime réelle en référence) →
 * validation tolérante → restitution horodatée. Scènes : nominal, panne
 * injectée + reprise, résultat dupliqué déterministe (même empreinte).
 * Le transport réseau réel (sockets, 2 PC) reste NON EXÉCUTÉ ici :
 * sandbox = listen EACCES ; voir docs/M6_LAN_REPORT.md hors sandbox.
 * Usage : node scripts/m6-e2e-local.js [--out bench-logs/m6-e2e-<date>.json]
 */

const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { buildRegistry } = require('../nt-compat/src/registry');
const { matmulOrt, ortVersion } = require('../nt-compat/src/ort');
const { fromArray2D, toArray2D, matmul } = require('../nt-compat/src/tensors');
const { NeuroCore, buildPreset } = require('../neurocore/src/flow');
const { probeWorker, seedLearnerFromProbe, routeRequest, verifyTolerance } = require('../neurocore/src/adapt');
const { Learner } = require('../neurocore/src/learn');

function registry(noInt8) {
  const r = buildRegistry({ detectOpts: { benchN: 16 } });
  if (noInt8) {
    for (const b of Object.values(r.backends)) {
      if (b.available) {
        b.dtypes = (b.dtypes || []).filter((d) => d !== 'int8');
        if (!b.dtypes.length) b.available = false;
      }
    }
  }
  return r;
}

async function main() {
  const t0 = Date.now();
  const workers = [
    { id: 'wA', registry: registry(false) },
    { id: 'wB', registry: registry(true) },
  ];
  const learner = new Learner();
  const probes = workers.map((w) => probeWorker(w, { n: 32, reps: 3 }));
  for (let i = 0; i < workers.length; i++) seedLearnerFromProbe(learner, probes[i]);
  const graph = buildPreset('mixed-fp32-int8', { n: 16 });
  const model = { id: 'gemm-16', sizeBytes: 16 * 16 * 4, cachedOn: ['wA'], loadMs: { wA: 0, wB: 5 } };
  const route = routeRequest({ graph, model }, workers, { learner });
  // Exécution NeuroCore adaptative (même processus, fil compté).
  const nc = new NeuroCore({ workers, learner, strategy: 'adapt' });
  const run1 = await nc.run({ graph });
  // Doublon déterministe : même requête rejouée → même empreinte de résultat.
  const runDup = await nc.run({ graph });
  // Panne injectée sur graphe fp32 (deux workers compatibles) → replan attendu.
  const chain = buildPreset('chain-matmul-fp32', { n: 16 });
  const nc2 = new NeuroCore({ workers, strategy: 'adapt' });
  let once = true;
  const run2 = await nc2.run({ graph: chain }, {
    hooks: { onNode: async (id) => { if (once && id === 'mm1') { once = false; throw new Error('panne-injectee-m6'); } } },
  });
  // Inférence IA réelle ONNX Runtime (référence moteur externe, CPU).
  const n = 64;
  const X = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => ((i + j) % 7) * 0.5 - 1));
  const W = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => ((i - j) % 5) * 0.25));
  const ort = await matmulOrt(X, W, { ep: 'cpu' });
  const jsRef = toArray2D(matmul(fromArray2D(X, 'fp32'), fromArray2D(W, 'fp32')));
  const ortCheck = verifyTolerance(ort.Y, jsRef, { rtol: 1e-4, atol: 1e-6 });
  const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const report = {
    module: 'M6-E2E', portee: 'MEME HOTE, processus locaux — PAS multi-appareils',
    date: new Date().toISOString(), node: process.version, plateforme: `${os.platform()} ${os.arch()}`,
    ort: ortVersion(), route: { chosen: route.chosen, refusedDistribution: route.refusedDistribution },
    epreuves: probes.map((p) => ({ worker: p.workerId, hash: p.hash.slice(0, 16), matmulFp32Ms: p.ops.matmul_fp32.ms })),
    execution: {
      nominal: run1.outcome, panneReprise: run2.outcome,
      doublonDeterministe: hash(run1.value) === hash(runDup.value) ? hash(run1.value).slice(0, 16) : 'DIFFÉRENT',
      replanJournalise: nc2.decisions.some((d) => d.kind === 'replan'),
    },
    inferenceORT: { n, msMesure: +ort.ms.toFixed(4), accordVsJS: ortCheck },
    ramProcessusMo: +(process.memoryUsage().rss / 1048576).toFixed(1),
    dureeTotaleMs: Date.now() - t0,
    limites: 'sockets/2 PC NON exécutés (sandbox EACCES) ; énergie/VRAM non mesurées ; cloud non appelé',
  };
  console.log(`route choisie : ${JSON.stringify(route.chosen)}`);
  console.log(`nominal=${run1.outcome} panne+reprise=${run2.outcome} doublon=${report.execution.doublonDeterministe} replan=${report.execution.replanJournalise}`);
  console.log(`ORT cpu n=${n} : ${ort.ms.toFixed(3)} ms, accord JS ok=${ortCheck.ok} maxRel=${ortCheck.maxRel.toExponential(2)}`);
  const out = (() => { const i = process.argv.indexOf('--out'); return i === -1 ? `bench-logs/m6-e2e-${new Date().toISOString().slice(0, 10)}.json` : process.argv[i + 1]; })();
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`rapport brut : ${out}`);
  if (run1.outcome !== 'done' || run2.outcome !== 'done' || !ortCheck.ok) process.exit(1);
}

main().catch((e) => { console.error('m6-e2e-local:', e.message); process.exit(1); });

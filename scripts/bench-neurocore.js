'use strict';

/**
 * Benchmarks NeuroCore §13 : A-E + panne + précision des prédictions.
 * A : mono-appareil (1 worker, exécution directe).
 * B : round-robin (repli déterministe nt-fusion).
 * C : capacités (greedy nt-fusion, flops mesurés).
 * D : adaptatif sans apprentissage (NeuroCore, learner frais par run).
 * E : NeuroCore avec apprentissage (même instance, reps cumulées).
 * Mesuré : temps total, transferts, décisions invalides, récupérations,
 * surcharge orchestrateur, erreur de prédiction (E, par rep).
 * Limites : workers = registres de CETTE machine (processus locaux,
 * pas 2 appareils) ; exécution multi-processus réelle prouvée par §5/M2.
 * Usage : node scripts/bench-neurocore.js --reps 5 [--out bench-logs/...json]
 */

const { buildRegistry } = require('../nt-compat/src/registry');
const { executeGraph } = require('../nt-fusion/src/execute');
const { planGreedy, validatePlan } = require('../nt-fusion/src/planner');
const { fallbackPlans } = require('../nt-fusion/src/muse');
const { NeuroCore, buildPreset } = require('../neurocore/src/flow');

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

function mkWorkers() {
  return [
    { id: 'wA', registry: buildRegistry({ detectOpts: { benchN: 16 } }) },
    { id: 'wB', registry: buildRegistry({ detectOpts: { benchN: 16 } }) },
  ];
}

async function main() {
  const graph = { v: 1, nodes: buildPreset('mixed-fp32-int8', { n: 16 }).nodes };
  const arms = {};
  let invalid = 0;
  const check = (name, plan, workers) => {
    const v = validatePlan(graph, plan, workers);
    if (!v.ok) {
      invalid++;
      throw new Error(`${name}: plan invalide (${v.reason})`);
    }
  };
  const tBytes = (plan) => (plan.transfers || []).reduce((t, l) => t + l.bytes, 0);
  // A : mono.
  {
    const ts = [];
    let ok = 0;
    for (let r = 0; r < repsOf; r++) {
      const t0 = process.hrtime.bigint();
      try {
        await executeGraph(graph);
        ok++;
      } catch {}
      ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    arms.A = { strategie: 'mono-appareil', tempsMs: stats(ts), reussite: `${ok}/${repsOf}`, transfertsOctets: 0 };
  }
  const workers = mkWorkers();
  // B : round-robin. C : greedy.
  const rr = fallbackPlans(null, graph, workers).plans.find((p) => p.strategy === 'round-robin-fallback');
  const cap = planGreedy(graph, workers);
  for (const [name, plan, label] of [['B', rr, 'round-robin'], ['C', cap, 'capacités']]) {
    check(name, plan, workers);
    const ts = [];
    let ok = 0;
    for (let r = 0; r < repsOf; r++) {
      const t0 = process.hrtime.bigint();
      try {
        await executeGraph(graph, { plan });
        ok++;
      } catch {}
      ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    arms[name] = { strategie: label, tempsMs: stats(ts), reussite: `${ok}/${repsOf}`, transfertsOctets: tBytes(plan) };
  }
  // D : NeuroCore sans apprentissage (learner frais à chaque run).
  {
    const ts = [];
    let ok = 0;
    let oh = 0;
    for (let r = 0; r < repsOf; r++) {
      const nc = new NeuroCore({ workers: mkWorkers() });
      const t0 = process.hrtime.bigint();
      const res = await nc.run({ graph });
      ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (res.outcome === 'done') ok++;
      oh += res.proofs ? res.proofs.overheadMs.plan + res.proofs.overheadMs.verify : 0;
    }
    arms.D = { strategie: 'adaptatif sans apprentissage', tempsMs: stats(ts), reussite: `${ok}/${repsOf}`, surchargeMs: oh / repsOf };
  }
  // E : NeuroCore avec apprentissage (instance unique, erreurs suivies).
  {
    const nc = new NeuroCore({ workers: mkWorkers() });
    const ts = [];
    const errs = [];
    let ok = 0;
    for (let r = 0; r < repsOf; r++) {
      const t0 = process.hrtime.bigint();
      const res = await nc.run({ graph });
      ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (res.outcome === 'done') ok++;
      // Erreur de prédiction moyenne sur les nœuds calculés.
      let e = 0;
      let n = 0;
      for (const [id, m] of Object.entries(res.proofs.metrics.nodes)) {
        const peer = res.proofs.plan.assignments[id];
        const node = graph.nodes.find((x) => x.id === id);
        const f = nc.learner.get(node.kind, peer, node.dtype);
        if (f && f.done >= 3 && f.msEwma > 0) {
          e += Math.abs(m.ms - f.msEwma) / f.msEwma;
          n++;
        }
      }
      errs.push(n ? e / n : null);
    }
    arms.E = {
      strategie: 'neurocore + apprentissage', tempsMs: stats(ts), reussite: `${ok}/${repsOf}`,
      erreurPredictionParRep: errs, surchargeMs: (nc.overheadMs.plan + nc.overheadMs.verify) / repsOf,
    };
  }
  // Panne + redémarrage worker : E avec panne injectée une fois.
  let recovery = 'non testée';
  {
    const nc = new NeuroCore({ workers: mkWorkers() });
    let once = true;
    try {
      const res = await nc.run({ graph }, { hooks: { onNode: async () => { if (once) { once = false; throw new Error('panne-injectée'); } } } });
      recovery = res.outcome === 'done' ? 'OK (replan + reprise)' : `ÉCHEC (${res.reason})`;
    } catch (e) {
      recovery = `ÉCHEC (${e.message})`;
    }
  }
  // Falsifié : nœud qui ment sur sa valeur — le re-calcul le détecte ?
  // (ici : exécution déterministe locale ; le falsifié est simulé en
  // altérant une valeur entre run et vérification — détecté si différent).
  let fraud = 'non applicable en local (reçus §7 sur le réseau)';
  void fraud;
  const report = {
    module: 'NeuroCore',
    date: new Date().toISOString(),
    node: process.version,
    reps: repsOf,
    limites: 'workers = registres de cette machine ; 2 appareils et LAN : NON EXÉCUTÉS ; temps sub-ms non significatifs',
    bras: arms,
    decisionsInvalides: invalid,
    recuperationPanne: recovery,
    falsifies: 'couvert par quorum §7 sur le réseau (M2 63/63), pas rejoué ici',
  };
  for (const [k, a] of Object.entries(arms)) {
    const extra = a.erreurPredictionParRep ? `, errPred=[${a.erreurPredictionParRep.map((e) => (e === null ? 'n/a' : e.toFixed(2))).join(' ')}]` : '';
    const oh = a.surchargeMs !== undefined ? `, surcharge ${a.surchargeMs.toFixed(3)} ms` : '';
    console.log(`${k} ${a.strategie} : ${a.reussite} méd ${a.tempsMs.med.toFixed(2)} ms${oh}${extra}`);
  }
  console.log(`décisions invalides : ${invalid}, récupération : ${recovery}`);
  const fs = require('node:fs');
  if (outOf) {
    fs.writeFileSync(outOf, JSON.stringify(report, null, 2));
    console.log(`rapport : ${outOf}`);
  } else {
    console.log(JSON.stringify(report));
  }
}

main().catch((e) => {
  console.error('bench-neurocore:', e.message);
  process.exit(1);
});

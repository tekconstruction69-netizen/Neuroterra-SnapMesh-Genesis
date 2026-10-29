'use strict';

/**
 * NT-ADAPT : partition globale, mémoire cumulée, repli local, tolérance,
 * épreuve réelle, compression au bénéfice net mesuré. Zéro Muse au runtime.
 * Les facteurs de vitesse/liens appliqués aux registres sont ÉMULÉS
 * (étiquetés tels quels) : ils prouvent la décision, pas un matériel.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { buildRegistry } = require('../../nt-compat/src/registry');
const { planGreedy, validatePlan } = require('../../nt-fusion/src/planner');
const { NeuroCore, buildPreset } = require('../src/flow');
const { Learner } = require('../src/learn');
const {
  planAdapt, planRoundRobin, verifyTolerance, probeWorker,
  seedLearnerFromProbe, measureLegWire, TOLERANCES,
} = require('../src/adapt');

function registry({ flopFactor = 1, noInt8 = false, capBytes = null } = {}) {
  const r = buildRegistry({ detectOpts: { benchN: 8 } });
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

const SLOW = { 'wB->wA': 256 * 1024, 'wA->wB': 256 * 1024 }; // lien émulé lent

function asymWorkers() {
  return [
    { id: 'wA', registry: registry({}) }, // seul avec int8
    { id: 'wB', registry: registry({ flopFactor: 8, noInt8: true }) }, // fp32 émulé rapide
  ];
}

test('adapt : évite le transfert lent que le glouton paie (coupe au cast)', () => {
  const graph = buildPreset('mixed-fp32-int8', { n: 8 });
  const workers = asymWorkers();
  const greedy = planGreedy(graph, workers, { netBps: SLOW });
  const adapt = planAdapt(graph, workers, { netBps: SLOW });
  assert.equal(validatePlan(graph, adapt.plan, workers).ok, true);
  const gBytes = greedy.transfers.reduce((s, l) => s + l.bytes, 0);
  assert.ok(gBytes > 0, 'glouton sans transfert (scénario invalide)');
  assert.equal(adapt.transferBytes, 0, `adapt transfère encore ${adapt.transferBytes} o`);
  assert.equal(adapt.plan.assignments.mm, 'wA', 'mm doit être colocé avec la chaîne int8');
  assert.ok(adapt.makespanMs < 5, `makespan adapt inattendu ${adapt.makespanMs}`);
});

test('adapt : mémoire cumulée par worker (infaisable pour le contrôle par nœud)', () => {
  const graph = buildPreset('batch-add', { n: 16 });
  const cap = 6000; // 1 nœud (1024 o) passe ; tout-sur-un (7168 o) échoue, split (≤4096 o) passe
  const workers = [
    { id: 'wA', registry: registry({ capBytes: cap }) },
    { id: 'wB', registry: registry({ capBytes: cap }) },
  ];
  const adapt = planAdapt(graph, workers, {});
  assert.equal(validatePlan(graph, adapt.plan, workers).ok, true);
  assert.notEqual(adapt.plan.assignments.s1, adapt.plan.assignments.s2,
    'les deux branches doivent être séparées par la borne cumulée');
  assert.ok(adapt.rejected.memoire > 0, 'aucun rejet mémoire compté');
  // Deadline absurde : aucun plan faisable, refus motivé (jamais de plan forcé).
  assert.throws(() => planAdapt(graph, workers, { deadlineMs: 1e-9 }), /aucun plan faisable/);
});

test('adapt : repli local explicite quand distribuer ne paie pas', () => {
  const graph = buildPreset('mixed-fp32-int8', { n: 4 });
  const workers = [
    { id: 'wA', registry: registry({}) },
    { id: 'wB', registry: registry({}) },
  ];
  const adapt = planAdapt(graph, workers, {});
  assert.equal(adapt.plan.strategy, 'nt-adapt-local');
  assert.match(adapt.reason, /repli local/);
  const used = new Set(Object.values(adapt.plan.assignments));
  assert.equal(used.size, 1, 'repli local éclaté sur plusieurs workers');
});

test('adapt : round-robin aveugle peut être invalide, adapt jamais (arbitre)', () => {
  const graph = buildPreset('mixed-fp32-int8', { n: 4 });
  const workers = asymWorkers();
  const rr = planRoundRobin(graph, workers);
  // Selon la parité, rr place un nœud int8 sur wB (sans int8) : invalide OU valide,
  // mais adapt doit toujours passer validatePlan.
  void rr;
  const adapt = planAdapt(graph, workers, {});
  assert.equal(validatePlan(graph, adapt.plan, workers).ok, true);
});

test('vérification tolérante : accepte arrondi fp32, rejette faute franche', () => {
  const exp = [[100, -50], [0.001, 2]];
  const ok = verifyTolerance([[100.001, -50.001], [0.001, 2]], exp, TOLERANCES.fp32);
  assert.equal(ok.ok, true, `arrondi rejeté : ${JSON.stringify(ok)}`);
  const bad = verifyTolerance([[110, -50], [0.001, 2]], exp, TOLERANCES.fp32);
  assert.equal(bad.ok, false);
  assert.ok(bad.maxRel > 0.05);
  // Chaîne int8 : l'erreur de quantification mesurée NT-UCP (1,4 %) passe à 3 %.
  const q = verifyTolerance([[101.4]], [[100]], TOLERANCES.int8);
  assert.equal(q.ok, true);
});

test('épreuve réelle : reçu mesuré, empreinte stable, alimente l’apprenant', () => {
  const [wA] = asymWorkers();
  const r1 = probeWorker(wA, { n: 16, reps: 3 });
  assert.match(r1.hash, /^[0-9a-f]{64}$/);
  assert.ok(r1.ops.matmul_fp32.ms > 0);
  assert.ok(r1.ops.matmul_fp32.maxErrVsFp64 < 1e-3, `erreur sonde ${r1.ops.matmul_fp32.maxErrVsFp64}`);
  const learner = new Learner();
  seedLearnerFromProbe(learner, r1);
  assert.ok(learner.get('matmul', 'wA', 'fp32').done >= 1);
});

test('compression : bénéfice net mesuré seulement (répétitif oui, aléatoire non)', () => {
  const slowBps = 1 * 1024 * 1024;
  const rep = measureLegWire(Buffer.alloc(65536, 7), { bps: slowBps });
  assert.notEqual(rep.codec, 'raw', `répétitif non compressé : ${JSON.stringify(rep)}`);
  assert.ok(rep.benefitMs > 0);
  const rnd = measureLegWire(crypto.randomBytes(65536), { bps: slowBps });
  assert.equal(rnd.codec, 'raw');
});

test('NT-ADAPT 2 routage : cache, confidentialité, refus distribué, cloud sans appel', () => {
  const { routeRequest } = require('../src/adapt');
  const graph = buildPreset('chain-matmul-fp32', { n: 4 });
  const workers = [
    { id: 'wA', registry: registry({}) },
    { id: 'wB', registry: registry({}) },
  ];
  const model = { id: 'm1', sizeBytes: 10 * 1024 * 1024, cachedOn: ['wB'], loadMs: { wA: 500, wB: 0 } };
  const r = routeRequest({ graph, model }, workers, {});
  assert.ok(r.chosen, 'aucun candidat choisi');
  const hostB = r.candidates.find((x) => x.kind === 'hosting' && x.worker === 'wB');
  const hostA = r.candidates.find((x) => x.kind === 'hosting' && x.worker === 'wA');
  assert.ok(hostB.estMs < hostA.estMs, 'le cache doit avantager wB');
  assert.ok(r.candidates.some((x) => x.kind === 'cloud' && x.feasible === false), 'cloud doit rester non appelé');
  // Confidentialité : distribution refusée avec motif, worker nié jamais choisi.
  const priv = routeRequest({ graph, model }, workers, { constraints: { localOnly: true, localWorkerId: 'wA' } });
  assert.ok(priv.refusedDistribution && /confidentialité/.test(priv.refusedDistribution));
  const denied = routeRequest({ graph, model }, workers, { constraints: { deniedWorkers: ['wB'] } });
  assert.notEqual(denied.chosen && denied.chosen.worker, 'wB');
});

test('NeuroCore strategy=adapt : run autonome exact, défaut legacy inchangé', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Muse appelé au runtime (INTERDIT)'); };
  try {
    const nc = new NeuroCore({ workers: asymWorkers(), strategy: 'adapt', adaptOpts: { netBps: SLOW } });
    const r = await nc.run({ preset: 'mixed-fp32-int8', params: { n: 4 } });
    assert.equal(r.outcome, 'done', r.reason);
    assert.equal(r.proofs.verified, true);
    assert.ok(nc.decisions.some((d) => d.kind === 'plan'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

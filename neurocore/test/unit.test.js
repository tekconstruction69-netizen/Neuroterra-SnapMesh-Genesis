'use strict';

/**
 * NeuroCore : autonomie (zéro Muse), exactitude, apprentissage,
 * panne, frein, reprise d'état, décisions invalides rejetées.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { NeuroCore, classify } = require('../src/flow');
const { Learner } = require('../src/learn');
const { evalPlacement } = require('../src/cost');
const { chooseCut, chooseSplit } = require('../src/recompose');
const { buildRegistry } = require('../../nt-compat/src/registry');

function workers() {
  return [
    { id: 'wA', registry: buildRegistry({ detectOpts: { benchN: 8 } }) },
    { id: 'wB', registry: buildRegistry({ detectOpts: { benchN: 8 } }) },
  ];
}

function oracleChain(n) {
  const M = (f) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
  const A = M((i, j) => i + j + 1);
  const B = M((i, j) => (i - j) * 0.5);
  const C = M(() => 1);
  const mm = (X, Y) => X.map((r, i) => Y[0].map((_, j) => r.reduce((s, _, k) => s + X[i][k] * Y[k][j], 0)));
  const t = mm(A, B);
  return mm(t, C);
}

test('autonomie : run complet sans Muse (fetch espion + env configuré)', async () => {
  // Même avec une clé/URL configurées ET un fetch qui lève si appelé,
  // NeuroCore termine : il ne doit JAMAIS appeler Muse au runtime.
  process.env.MUSE_API_URL = 'https://injoignable.invalid';
  process.env.MUSE_API_KEY = 'cle-factice';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Muse appelé au runtime (INTERDIT)'); };
  try {
    const nc = new NeuroCore({ workers: workers() });
    const r = await nc.run({ preset: 'chain-matmul-fp32', params: { n: 4 } });
    assert.equal(r.outcome, 'done');
    assert.deepEqual(r.value, oracleChain(4));
    assert.equal(r.proofs.verified, true);
    assert.ok(nc.decisions.some((d) => d.kind === 'plan'), 'plan non journalisé');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.MUSE_API_URL;
    delete process.env.MUSE_API_KEY;
  }
});

test('presets : mixed int8 et batch exacts, plans valides', async () => {
  const nc = new NeuroCore({ workers: workers() });
  const m = await nc.run({ preset: 'mixed-fp32-int8', params: { n: 4 } });
  assert.equal(m.outcome, 'done');
  assert.equal(m.proofs.verified, true);
  assert.equal(m.value.length, 4, 'shape finale inattendue');
  const b = await nc.run({ preset: 'batch-add', params: { n: 4 } });
  assert.equal(b.outcome, 'done');
  // Oracle batch : (A+B)+(C+D) en [0][0] : (0+0)+(0+2+3) = 5.
  assert.equal(b.value[0][0], 5);
  assert.equal(b.value[1][1], (1 + 1) + (1 * 1) + 2 + 3);
  assert.throws(() => classify({ preset: 'inconnu' }), /preset inconnu/);
  assert.throws(() => classify(null), /objet requise/);
});

test('NT-LEARN : convergence, hystérésis, dérive, borne mémoire', () => {
  const l = new Learner();
  assert.equal(l.get('matmul', 'wA', 'fp32'), null, 'fiche avant observation');
  // Convergence : 10 observations stables ~2 ms.
  for (let i = 0; i < 10; i++) l.observe({ op: 'matmul', workerId: 'wA', dtype: 'fp32', ms: 2, flops: 1000 });
  const f = l.get('matmul', 'wA', 'fp32');
  assert.equal(f.done, 10);
  assert.ok(Math.abs(f.msEwma - 2) < 1e-9, `ewma non convergée : ${f.msEwma}`);
  assert.ok(l.predictError('matmul', 'wA', 'fp32', 2.1) < 0.1, 'erreur élevée sur stable');
  assert.equal(l.predictError('matmul', 'wX', 'fp32', 2), null, 'erreur sans mesures');
  // Hystérésis : gain < 10 % => on garde l'actuel (pas d'oscillation).
  assert.equal(l.prefer('wA', [{ id: 'wA', costMs: 10 }, { id: 'wB', costMs: 9.5 }]), 'wA');
  assert.equal(l.prefer('wA', [{ id: 'wA', costMs: 10 }, { id: 'wB', costMs: 8 }]), 'wB');
  // Dérive : 2 surprises > 3× => réinitialisation.
  l.observe({ op: 'matmul', workerId: 'wA', dtype: 'fp32', ms: 50, flops: 1000 });
  l.observe({ op: 'matmul', workerId: 'wA', dtype: 'fp32', ms: 50, flops: 1000 });
  assert.equal(l.get('matmul', 'wA', 'fp32').done, 0, 'dérive non réinitialisée');
  // Échecs comptés (fiabilité), borne mémoire.
  l.observe({ op: 'x', workerId: 'w', dtype: 'fp32', ms: 1, ok: false });
  assert.equal(l.get('x', 'w', 'fp32').failed, 1);
  for (let i = 0; i < 600; i++) l.observe({ op: `op${i}`, workerId: 'w', dtype: 'fp32', ms: 1 });
  assert.ok(l.stats.size <= 500, `historique non borné : ${l.stats.size}`);
  // Export/import (reprise coordinateur).
  const l2 = Learner.fromJSON(JSON.parse(JSON.stringify(l.toJSON())));
  assert.ok(l2.stats.size === l.stats.size);
  assert.throws(() => l.observe({ op: 'x', workerId: 'w', dtype: 'fp32', ms: -1 }), /ms invalide/);
});

test('NT-COST : refuse incompatible, quantifie incertitude', () => {
  const [wA] = workers();
  const ok = evalPlacement({
    node: { id: 'n', kind: 'matmul', dtype: 'fp32', flops: 1000 },
    shape: [8, 8], worker: wA, inputBytes: 0, learned: null,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.uncertainty, 1, 'incertitude sans mesures non maximale');
  const withLearn = evalPlacement({
    node: { id: 'n', kind: 'matmul', dtype: 'fp32', flops: 1000 },
    shape: [8, 8], worker: wA, inputBytes: 0,
    learned: { flops: 1e6, done: 20, failed: 0 },
  });
  assert.ok(withLearn.uncertainty < 0.5, `incertitude non resserrée : ${withLearn.uncertainty}`);
  const no = evalPlacement({
    node: { id: 'n', kind: 'matmul', dtype: 'bf16', flops: 1 },
    shape: [2, 2], worker: wA, inputBytes: 0, learned: null,
  });
  assert.equal(no.ok, false);
  assert.match(no.reason, /bf16/);
});

test('NT-RECOMPOSE : coupe et split expliqués', () => {
  const cut = chooseCut({ bytesBefore: 2304, bytesAfter: 576, bps: 25 * 1024 * 1024, tCastMs: 0.05 });
  assert.equal(cut.choice, 'apres-cast');
  assert.ok(cut.costs.apresMs < cut.costs.avantMs);
  const cut2 = chooseCut({ bytesBefore: 100, bytesAfter: 576, bps: 25 * 1024 * 1024 });
  assert.equal(cut2.choice, 'avant-cast');
  const sp = chooseSplit({ tMonoMs: 10, fragCalcMs: 3, tFusionMs: 0.5, tTransfertMs: 0.5, k: 4 });
  assert.equal(sp.choice, 'split-4');
  const mono = chooseSplit({ tMonoMs: 10, fragCalcMs: 9.5, tFusionMs: 1, tTransfertMs: 1, k: 2 });
  assert.equal(mono.choice, 'monolithe', 'split non rentable choisi');
  assert.throws(() => chooseSplit({ tMonoMs: 10, fragCalcMs: 3, k: 9 }), /k 2..8/);
});

test('panne worker : replan sans lui, tâche sauvée', async () => {
  const nc = new NeuroCore({ workers: workers() });
  // Panne totale de wB au premier passage (tout nœud assigné wB échoue).
  let firstPass = true;
  const hooks = {
    onNode: async (id) => {
      void id;
      // On lit le plan courant via le journal : échec simulé une fois.
      if (firstPass) {
        firstPass = false;
        throw new Error('panne-injectée-wB');
      }
    },
  };
  const r = await nc.run({ preset: 'chain-matmul-fp32', params: { n: 4 } }, { hooks });
  assert.equal(r.outcome, 'done', `reprise échouée : ${r.reason}`);
  assert.deepEqual(r.value, oracleChain(4));
  assert.ok(nc.decisions.some((d) => d.kind === 'replan'), 'replan non journalisé');
});

test('frein fermé : refus propre, reprise état, invalide rejeté', async () => {
  const nc = new NeuroCore({ workers: workers(), brake: () => ({ go: false, reason: 'STOPPED' }) });
  const r = await nc.run({ preset: 'chain-matmul-fp32', params: { n: 4 } });
  assert.equal(r.outcome, 'refused');
  assert.match(r.reason, /STOPPED/);
  // Reprise d'état (NT-SURVIVE) : décisions + apprentissage restaurés.
  const nc2 = new NeuroCore({ workers: workers() });
  await nc2.run({ preset: 'chain-matmul-fp32', params: { n: 4 } });
  const st = nc2.exportState();
  const nc3 = NeuroCore.importState(workers(), st);
  assert.ok(nc3.learner.stats.size > 0, 'apprentissage non restauré');
  const r3 = await nc3.run({ preset: 'chain-matmul-fp32', params: { n: 4 } });
  assert.equal(r3.outcome, 'done');
  assert.deepEqual(r3.value, oracleChain(4));
  // Décision invalide : graphe exigeant int8, worker sans int8 => échec motivé.
  const noInt = workers();
  for (const b of Object.values(noInt[0].registry.backends)) {
    if (b.available) {
      b.dtypes = (b.dtypes || []).filter((d) => d !== 'int8');
      if (!b.dtypes.length) b.available = false;
    }
  }
  const nc4 = new NeuroCore({ workers: [noInt[0]] });
  const r4 = await nc4.run({ preset: 'mixed-fp32-int8', params: { n: 4 } });
  assert.equal(r4.outcome, 'failed');
  assert.match(r4.reason, /aucun worker compatible/);
});

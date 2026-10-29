'use strict';

/** Tests unitaires §5 : validation DAG, refs, merges, presets. Aucun réseau. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  FRAG_V, MERGES, validateDag, topoOrder, substituteRefs,
  eligibleIds, buildChainMatmul, buildBatchFib, buildSplitWordcount,
} = require('../src/fragments');

const F = (over = {}) => ({
  v: FRAG_V, id: 'f', op: 'fib', args: { n: 5 }, deps: [],
  timeoutMs: 1000, expiryMs: 60000,
  validation: { strategy: 'single', redundancy: 1 },
  ...over,
});
const DAG = (fragments, merge = 'concat') => ({ v: FRAG_V, merge, fragments });

test('dag : cycle détecté, dep inconnue, id dupliqué, op inconnue rejetés', () => {
  const a = F({ id: 'a', deps: ['b'] });
  const b = F({ id: 'b', deps: ['a'] });
  assert.throws(() => validateDag(DAG([a, b])), /cycle/);
  assert.throws(() => validateDag(DAG([F({ id: 'a', deps: ['fantome'] })])), /dep inconnue/);
  assert.throws(() => validateDag(DAG([F({ id: 'x' }), F({ id: 'x' })])), /dupliqué/);
  assert.throws(() => validateDag(DAG([F({ op: 'rm-rf' })])), /op inconnue/);
  assert.throws(() => validateDag(DAG([F()], 'merge-inexistant')), /merge inconnu/);
  assert.throws(() => validateDag(DAG([F({ id: 'a', deps: ['a'] })])), /auto-dépendance/);
});

test('dag : $ref hors deps rejeté, bornes timeout/expiry/redundancy vérifiées', () => {
  assert.throws(
    () => validateDag(DAG([F({ id: 'a' }), F({ id: 'b', args: { x: { $ref: 'a' } }, deps: [] })])),
    /hors deps/
  );
  assert.throws(() => validateDag(DAG([F({ timeoutMs: 50 })])), /timeoutMs/);
  assert.throws(() => validateDag(DAG([F({ expiryMs: 0 })])), /expiryMs/);
  assert.throws(
    () => validateDag(DAG([F({ validation: { strategy: 'single', redundancy: 9 } })])),
    /redundancy/
  );
  assert.throws(() => validateDag(DAG([F({ minRes: { cpus: 0 } })])), /minRes/);
});

test('dag : ordre topologique respecte les dépendances', () => {
  const dag = DAG([
    F({ id: 'c', args: { x: { $ref: 'a' } }, deps: ['a', 'b'] }),
    F({ id: 'a' }),
    F({ id: 'b', deps: ['a'] }),
  ]);
  assert.equal(validateDag(dag), true);
  const order = topoOrder(dag).map((f) => f.id);
  assert.ok(order.indexOf('a') < order.indexOf('b'));
  assert.ok(order.indexOf('b') < order.indexOf('c'));
});

test('refs : substitution profonde + chemin, manquante rejetée', () => {
  const results = new Map([['m', { count: 25 }], ['t', 'ab']]);
  assert.deepEqual(
    substituteRefs({ a: { $ref: 'm.count' }, b: [{ $ref: 't' }], c: 1 }, results),
    { a: 25, b: ['ab'], c: 1 }
  );
  assert.throws(() => substituteRefs({ x: { $ref: 'z' } }, results), /ref-manquante/);
  assert.throws(() => substituteRefs({ x: { $ref: 'm.profond.absent' } }, results), /ref-chemin-invalide/);
});

test('merge wordcount : recolle exact sur texte piégeux', () => {
  // Oracle manuel indépendant (pas runOp) : le merge doit s'y conformer.
  const text = 'bonjour le monde\n\nligne accentuée été\nfin sans retour';
  const oracle = {
    words: (text.match(/\S+/g) || []).length,
    lines: text.split('\n').length,
    chars: text.length,
  };
  const dag = buildSplitWordcount(text, 3);
  assert.equal(validateDag(dag), true);
  assert.equal(dag.fragments.length, 3);
  // Simule l'exécution locale des parts (même formule que l'op, écrite ici à la main).
  const partResults = dag.fragments.map((f) => {
    const t = f.args.text;
    return { value: { words: (t.match(/\S+/g) || []).length, lines: t.length ? t.split('\n').length : 0, chars: t.length } };
  });
  assert.deepEqual(MERGES.wordcount(partResults, dag.partCount), oracle);
});

test('merge wordcount : texte vide et une seule part', () => {
  const dag = buildSplitWordcount('', 4);
  assert.equal(dag.fragments.length, 1);
  assert.equal(validateDag(dag), true);
  assert.deepEqual(MERGES.wordcount([{ value: { words: 0, lines: 0, chars: 0 } }], 1), { words: 0, lines: 0, chars: 0 });
});

test('presets : chaîne matmul et lot fib valides, formes exactes', () => {
  const I = [[1, 0], [0, 1]];
  const A = [[1, 2], [3, 4]];
  const B = [[5, 6], [7, 8]];
  const dag = buildChainMatmul([I, A, B]);
  assert.equal(dag.fragments.length, 2);
  assert.equal(validateDag(dag), true);
  assert.deepEqual(dag.fragments[1].args, { a: { $ref: 'mm-0' }, b: B });
  // I×A×B = A×B = [[19,22],[43,50]] : oracle arithmétique manuel.
  assert.deepEqual(
    [[1 * 5 + 2 * 7, 1 * 6 + 2 * 8], [3 * 5 + 4 * 7, 3 * 6 + 4 * 8]],
    [[19, 22], [43, 50]]
  );
  const batch = buildBatchFib([20, 25], { redundancy: 2 });
  assert.equal(validateDag(batch), true);
  assert.equal(batch.fragments[0].validation.strategy, 'quorum');
  assert.deepEqual(MERGES.concat([{ value: 1 }, { value: [2, 3] }]), [1, 2, 3]);
  assert.equal(MERGES.last([{ value: 'x' }, { value: 'y' }]), 'y');
});

test('câblage : ComputeNode.submitDag exécute un DAG vague par vague', async () => {
  // FAIL-FIRST : échoue tant que submitDag n'existe pas (TypeError).
  const { EventEmitter } = require('node:events');
  const { ComputeNode } = require('../src/compute');
  const { Identity } = require('../../mesh-net/src/identity');
  const stub = new EventEmitter();
  stub.identity = Identity.generate();
  stub.id = stub.identity.id; // vrai nœud : id = empreinte de la clé
  stub.knownPub = new Map();
  stub.registry = { live: () => [] };
  stub.caps = () => ({ cpus: 2 });
  stub._sendTo = () => false;
  stub.sendEncrypted = () => 'encrypted';
  const c = new ComputeNode(stub, {});
  const dag = buildBatchFib([10, 15]);
  const job = await c.submitDag(dag);
  assert.equal(job.outcome, 'done');
  assert.deepEqual(job.value, [55, 610]);
  assert.equal(job.fragments.length, 2);
  assert.ok(job.fragments.every((f) => f.outcome === 'done'));
  await c.sandbox.shutdown();
});

test('frein safety : placement refusé quand le contrôleur ne contribue pas', async () => {
  // FAIL-FIRST : échoue tant que ComputeNode ignore l'option brake.
  const { EventEmitter } = require('node:events');
  const { ComputeNode } = require('../src/compute');
  const stub = new EventEmitter();
  stub.id = 'brake-tt';
  stub.registry = { live: () => [] };
  stub.caps = () => ({ cpus: 2 });
  let sent = 0;
  stub._sendTo = () => { sent++; return true; };
  stub.sendEncrypted = () => { sent++; return 'encrypted'; };
  const denied = [];
  stub.on('brake-denied', (e) => denied.push(e));
  const c = new ComputeNode(stub, { brake: () => ({ go: false, reason: 'STOPPED' }) });
  const res = await c.submit('fib', { n: 5 }, { redundancy: 1 });
  assert.equal(res.outcome, 'failed', 'tâche placée malgré le frein');
  assert.equal(sent, 0, 'TASK diffusée malgré le frein');
  assert.equal(denied.length, 1);
  assert.equal(denied[0].reason, 'STOPPED');
  // Même frein sur le chemin décisionnel Muse (aucun exécutant proposé).
  const plan = await c.planWithMuse({ op: 'fib', args: { n: 5 } });
  assert.deepEqual(plan.executors, []);
  assert.match(plan.reason, /STOPPED/);
  await c.sandbox.shutdown();
});

test('P8 : exécutant STOPpé refuse la TASK (rien exécuté, rien renvoyé)', async () => {
  // P8 (audit) : le frein vaut aussi côté exécutant. Preuve : exec-refused
  // émis, sandbox jamais sollicité, aucun RESULT vers le coordinateur.
  const { EventEmitter } = require('node:events');
  const { ComputeNode } = require('../src/compute');
  const stub = new EventEmitter();
  stub.id = 'exec-stop';
  stub.registry = { live: () => [] };
  stub.caps = () => ({ cpus: 2 });
  let results = 0;
  stub.sendEncrypted = () => { results++; return 'encrypted'; };
  const refused = [];
  stub.on('exec-refused', (e) => refused.push(e));
  let ran = 0;
  stub.on('exec', () => ran++);
  const c = new ComputeNode(stub, { brake: () => ({ go: false, reason: 'STOPPED' }) });
  await c._handleTask('coord-x', { v: 1, taskId: 't-stop', op: 'fib', args: { n: 10 } });
  assert.equal(refused.length, 1, 'refus non signalé');
  assert.equal(refused[0].reason, 'frein');
  assert.equal(ran, 0, 'tâche exécutée malgré STOP');
  assert.equal(results, 0, 'RESULT renvoyé malgré STOP');
  assert.equal(c.sandbox.stats().started, 0, 'sandbox sollicité malgré STOP');
  await c.sandbox.shutdown();
});

test('câblage flux : gros args compressés sur le fil + stats', async () => {
  // FAIL-FIRST : échoue tant que ComputeNode ignore l'option flux.
  const { EventEmitter } = require('node:events');
  const { ComputeNode } = require('../src/compute');
  const stub = new EventEmitter();
  stub.id = 'flux-tt';
  stub.registry = { live: () => [] };
  stub.caps = () => ({ cpus: 2 });
  const sent = [];
  stub.sendEncrypted = (id, type, payload) => {
    sent.push({ id, type, payload });
    return 'encrypted';
  };
  const stats = [];
  stub.on('flux-stats', (s) => stats.push(s));
  const c = new ComputeNode(stub, { flux: { enabled: true, effort: 'normal' } });
  const big = 'phrase compressible répétée. '.repeat(2000); // ~60 Ko
  // Intercepte le RESULT auto (coordinateur == soi) pour lire l'ack dedup.
  const results = [];
  const origResult = c._handleResult.bind(c);
  c._handleResult = (from, p, meta) => {
    results.push(p);
    return origResult(from, p, meta);
  };
  await c._handleTask(stub.id, { v: 1, taskId: 'fx-1', op: 'wordcount', args: { text: big } });
  // Auto-réponse : RESULT direct (pas de send) ; le fil est prouvé par stats.
  assert.ok(stats.some((s) => s.dir === 'recv' && s.outBytes > 0), 'aucune stat flux réception');
  assert.ok(results.length === 1 && Array.isArray(results[0].dedupAck) && results[0].dedupAck.length === 1, 'ack dedup absent du RESULT');
  await c.sandbox.shutdown();
});

test('minRes : filtrage cpus + échec fermé si mémoire exigée et inconnue', () => {
  const cands = [
    { id: 'gros', cpus: 8, memFreeBytes: 8 * 1024 ** 3 },
    { id: 'petit', cpus: 1, memFreeBytes: 512 * 1024 ** 2 },
    { id: 'mystere', cpus: 8, memFreeBytes: null },
  ];
  assert.deepEqual(eligibleIds(cands, { cpus: 4 }), ['gros', 'mystere']);
  assert.deepEqual(eligibleIds(cands, { memFreeBytes: 1024 ** 3 }), ['gros']);
  assert.deepEqual(eligibleIds(cands, {}), ['gros', 'petit', 'mystere']);
});

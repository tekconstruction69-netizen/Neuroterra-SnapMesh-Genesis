#!/usr/bin/env node
'use strict';

/**
 * M5 — pilote NeuroCore sur sockets reels (UN PC, processus separes).
 * Coordinateur en-process (SnapMeshNode + ComputeNode, excludeSelf) +
 * N workers `compute-node.js` enfants. Graphe FUSION mixte fp32/int8
 * converti via le pont (fusionToDag) et distribue (distribute) :
 * AUCUN appel Muse sur ce chemin (ni reseau, ni cle requise).
 * Scenes : maillage, job1 exact, KILL worker, reprise job2 exacte,
 * relance, job3 exacte, arret propre. Echec EACCES => exit 2
 * (ENVIRONNEMENT : sandbox Muse, a rejouer hors sandbox).
 *
 *   node mesh-compute/bin/m5-neurocore-run.js [--workers 2]
 *     [--port-base 49401] [--discovery-port 47903]
 *     [--log-dir bench-logs] [--tag m5nc]
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { SnapMeshNode } = require('snapmesh-mesh-net');
const { ComputeNode } = require('../src/compute');
const { fromArray2D, toArray2D } = require('../../nt-compat/src/tensors');
const { executeGraph } = require('../../nt-fusion/src/execute');
const { fusionToDag, distribute } = require('../../neurocore/src/mesh');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

const NWORK = Math.max(1, Number(arg('workers', '2')));
const BASE = Number(arg('port-base', '49401'));
const DISC = Number(arg('discovery-port', '47903'));
const TAG = arg('tag', 'm5nc');
const LOGDIR = path.resolve(arg('log-dir', 'bench-logs'));
const WORK = path.join(__dirname, '..', 'test', '.tmp-m5nc');
const NODEJS = path.join(__dirname, 'compute-node.js');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG = path.join(LOGDIR, `${TAG}-neurocore-${stamp}.log`);
function say(m) {
  const line = `[m5nc] ${m}`;
  console.log(line);
  fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
}
function isEnvBlock(e) {
  return /EACCES|eacces/i.test(String((e && e.message) || e));
}

function M(f) {
  return (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
}
/** Graphe mixte (identique au pattern prouve neurocore/test/mesh.test.js). */
function graph() {
  return { v: 1, nodes: [
    { id: 'A', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[0]] } },
    { id: 'B', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[0]] } },
    { id: 'mm', kind: 'matmul', dtype: 'fp32', deps: ['A', 'B'], in: { a: { $node: 'A' }, b: { $node: 'B' } } },
    { id: 'qi', kind: 'cast', dtype: 'int8', deps: ['mm'], in: { x: { $node: 'mm' } } },
    { id: 'C', kind: 'input', dtype: 'int8', deps: [], params: { values: [[0]] } },
    { id: 'mm2', kind: 'matmul', dtype: 'int8', deps: ['qi', 'C'], in: { a: { $node: 'qi' }, b: { $node: 'C' } } },
    { id: 'qf', kind: 'cast', dtype: 'fp32', deps: ['mm2'], in: { x: { $node: 'mm2' } } },
    { id: 'D', kind: 'input', dtype: 'fp32', deps: [], params: { values: [[0]] } },
    { id: 'out', kind: 'add', dtype: 'fp32', deps: ['qf', 'D'], in: { a: { $node: 'qf' }, b: { $node: 'D' } } },
  ]};
}
function inputs4() {
  const n = 4;
  const raw = {
    A: M((i, j) => (i + j) * 0.5)(n),
    B: M((i, j) => (i - j) * 0.25)(n),
    C: M((i, j) => ((i + j) % 5) - 2)(n),
    D: M(() => 1)(n),
  };
  return { raw, A: fromArray2D(raw.A, 'fp32'), B: fromArray2D(raw.B, 'fp32'), C: fromArray2D(raw.C, 'int8'), D: fromArray2D(raw.D, 'fp32') };
}
function localGraph(raw) {
  const inp = (id, dtype) => ({ id, kind: 'input', dtype, deps: [], params: { values: raw[id] } });
  return { v: 1, nodes: [
    inp('A', 'fp32'), inp('B', 'fp32'),
    { id: 'mm', kind: 'matmul', dtype: 'fp32', deps: ['A', 'B'], in: { a: { $node: 'A' }, b: { $node: 'B' } } },
    { id: 'qi', kind: 'cast', dtype: 'int8', deps: ['mm'], in: { x: { $node: 'mm' } } },
    inp('C', 'int8'),
    { id: 'mm2', kind: 'matmul', dtype: 'int8', deps: ['qi', 'C'], in: { a: { $node: 'qi' }, b: { $node: 'C' } } },
    { id: 'qf', kind: 'cast', dtype: 'fp32', deps: ['mm2'], in: { x: { $node: 'mm2' } } },
    inp('D', 'fp32'),
    { id: 'out', kind: 'add', dtype: 'fp32', deps: ['qf', 'D'], in: { a: { $node: 'qf' }, b: { $node: 'D' } } },
  ]};
}

async function waitFor(cond, timeoutMs, label) {
  const t0 = Date.now();
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout : ${label}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
function relErr(got, exp) {
  let worst = 0;
  let peak = 0;
  for (let i = 0; i < exp.length; i++) {
    for (let j = 0; j < exp[i].length; j++) {
      worst = Math.max(worst, Math.abs(got[i][j] - exp[i][j]));
      peak = Math.max(peak, Math.abs(exp[i][j]));
    }
  }
  return { worst, rel: worst / Math.max(1e-9, peak) };
}

async function main() {
  fs.mkdirSync(LOGDIR, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });
  // Garde M5 section 4 : consigner l'environnement Muse (jamais requis).
  const mv = ['MUSE_API_URL', 'MUSE_API_KEY', 'MUSE_MODEL'].filter((k) => process.env[k]);
  say(`garde-muse : variables presentes=[${mv.join(',') || 'aucune'}] (chemin flow/mesh/compute sans appel reseau)`);

  const kids = [];
  const spawnWorker = (i) => {
    const port = BASE + 1 + i;
    const out = path.join(LOGDIR, `${TAG}-w${i}-${stamp}.out.log`);
    const fd = fs.openSync(out, 'a');
    const k = spawn('node', [NODEJS, '--name', `${TAG}-w${i}`, '--port', String(port),
      '--status-port', String(port + 100), '--bind-host', '127.0.0.1',
      '--ephemeral', '--quiet', '--discovery-port', String(DISC)],
      { cwd: WORK, stdio: ['ignore', fd, fd] });
    say(`worker ${i} demarre (pid ${k.pid}, tcp ${port})`);
    kids[i] = k;
    return k;
  };

  let coord = null;
  let compute = null;
  try {
    for (let i = 0; i < NWORK; i++) spawnWorker(i);
    await new Promise((r) => setTimeout(r, 3000));
    for (const k of kids) {
      if (k.exitCode !== null) throw new Error(`worker mort prematurement (exit ${k.exitCode}) — EACCES probable en sandbox`);
    }
    coord = new SnapMeshNode({ name: `${TAG}-coord`, tcpPort: BASE, bindHost: '127.0.0.1',
      ephemeral: true, discoveryPort: DISC, statusPort: BASE + 100 });
    compute = new ComputeNode(coord, { excludeSelf: true });
    await coord.start();
    say(`coordinateur id=${coord.id.slice(0, 12)} tcp=${BASE}`);
    await waitFor(() => (coord.registry.live().length >= NWORK ? true : null), 30000,
      `maillage ${NWORK} workers`);
    say(`maillage OK : ${coord.registry.live().length} pair(s) [decouverte+auth+negociation]`);

    const ins = inputs4();
    const g = graph();
    const dag = fusionToDag(g, ins);
    say(`pont NeuroCore : ${dag.fragments.length} fragments (${dag.fragments.map((f) => f.op).join(',')})`);
    const local = await executeGraph(localGraph(ins.raw));
    const exp = toArray2D(local.values.get('out'));

    const runJob = async (tag) => {
      const { job } = await distribute(compute, g, ins, { jobId: `${TAG}-${tag}` });
      if (job.outcome !== 'done') throw new Error(`job ${tag} non done : ${JSON.stringify(job).slice(0, 300)}`);
      if (!job.fragments.every((f) => f.outcome === 'done')) throw new Error(`job ${tag} : fragment non done`);
      const remote = job.fragments.some((f) => (f.executedBy || []).some((id) => id !== coord.id));
      if (!remote) throw new Error(`job ${tag} : aucun fragment execute a distance`);
      const { worst, rel } = relErr(job.value.m, exp);
      if (!(rel < 1e-6)) throw new Error(`job ${tag} inexact (rel ${rel})`);
      say(`job ${tag} EXACT a distance (rel ${rel.toExponential(1)})`);
      return job;
    };

    await runJob('j1');
    // PANNE : kill brutal du worker 0, reprise sur survivants.
    say('PANNE : kill brutal du worker 0');
    kids[0].kill('SIGKILL');
    await waitFor(() => (coord.registry.live().length === NWORK - 1 ? true : null), 30000, 'eviction du mort');
    say('mort evince du registre (suspect->dead, ~6 s)');
    await runJob('j2');
    say('REPRISE APRES PANNE PROUVEE');
    // RECONNEXION : relance, re-maillage, job exact.
    spawnWorker(0);
    await new Promise((r) => setTimeout(r, 2000));
    if (kids[0].exitCode !== null) throw new Error('worker relance mort prematurement');
    await waitFor(() => (coord.registry.live().length >= NWORK ? true : null), 30000, 're-maillage');
    say('re-maillage OK');
    await runJob('j3');
    say('RECONNEXION PROUVEE');
    say('M5-NEUROCORE REUSSI (zero appel Muse, 3 jobs exacts, panne+reprise)');
  } catch (e) {
    say(`ECHEC : ${String((e && e.message) || e).slice(0, 400)}`);
    if (isEnvBlock(e)) { say('ENVIRONNEMENT BLOQUE : rejouer hors sandbox Muse.'); process.exitCode = 2; }
    else process.exitCode = 1;
  } finally {
    try { if (compute) await compute.sandbox.shutdown(); } catch {}
    try { if (coord) await coord.stop(); } catch {}
    for (const k of kids) { try { if (k.exitCode === null) k.kill('SIGKILL'); } catch {} }
    say('arret propre (sandbox+BYE+enfants)');
  }
}

main();

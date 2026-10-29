'use strict';

/**
 * Tests e2e §5 : jobs DAG réels sur 2 processus `compute-node`.
 * - chain-matmul : dépendances A×B puis ×C, merge `last`, valeur exacte.
 * - split-wordcount : 3 parts parallèles, merge exact vs oracle manuel.
 * - batch-fib : 3 fragments concurrents, merge `concat`, valeurs exactes.
 * Répartition prouvée : chaque job touche les 2 nœuds (ids exécutants).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'compute-node.js');
const children = [];
after(() => {
  for (const c of children) {
    try {
      c.kill('SIGKILL');
    } catch {}
  }
});

const workdir = path.join(__dirname, '.tmp-int');
fs.mkdirSync(workdir, { recursive: true });

const STATUS_GAP = 500;
const EXEC = 48352;

function launch(name, tcpPort, extraArgs = []) {
  const child = spawn(process.execPath, [BIN, '--name', name, '--port', String(tcpPort), '--status-port', String(tcpPort + STATUS_GAP), '--quiet', ...extraArgs], {
    cwd: workdir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.jobLines = [];
  child.allLines = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      child.allLines.push(line);
      const m = line.match(/^\[job\] (.*)$/);
      if (m) {
        try {
          child.jobLines.push(JSON.parse(m[1]));
        } catch {}
      }
    }
  });
  child.stderr.on('data', (d) => {
    child.allLines.push('[stderr] ' + d.toString().slice(0, 200));
  });
  return child;
}

function statusOf(tcpPort) {
  return new Promise((resolve, reject) => {
    const req = require('node:http').get(`http://127.0.0.1:${tcpPort + STATUS_GAP}/status`, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('status-timeout')));
  });
}

async function waitFor(fn, { timeoutMs = 60000, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch {}
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout (${timeoutMs} ms) : ${label}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Multiplication matricielle, oracle manuel indépendant (pas runOp). */
function mmul(a, b) {
  const n = a.length;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) out[i][j] += a[i][k] * b[k][j];
    }
  }
  return out;
}

const D = ['--no-discovery'];
const COMMON = [...D, '--submit-delay-ms', '9000', '--submit-wait-peers', '1'];

async function execId() {
  const s = await waitFor(() => statusOf(EXEC).catch(() => null), { label: 'statut exécutant' });
  return s.self.id;
}

function spreadOf(job) {
  return new Set(job.fragments.flatMap((f) => f.executedBy));
}

test('job chain-matmul : I×A×B exact, 2 fragments, 2 nœuds', async () => {
  launch('frag-exec', EXEC, D);
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const A = [[1, 2, 3], [0, 1, 4], [5, 6, 0]];
  const B = [[2, 0, 1], [1, 3, 0], [0, 1, 2]];
  const coord = launch('frag-mm', 48351, [
    '--peers', `127.0.0.1:${EXEC}`, ...COMMON,
    '--job', 'chain-matmul', '--job-params', JSON.stringify({ matrices: [I, A, B] }),
  ]);
  const job = await waitFor(() => (coord.jobLines.length ? coord.jobLines[0] : null), { label: 'job matmul' });
  assert.equal(job.outcome, 'done');
  assert.deepEqual(job.value, mmul(mmul(I, A), B));
  assert.equal(job.fragments.length, 2);
  assert.ok(job.fragments.every((f) => f.outcome === 'done'), JSON.stringify(job.fragments));
  const spread = spreadOf(job);
  assert.ok(spread.has(await execId()), 'exécutant distant inutilisé');
  assert.ok(spread.size >= 2, `chaîne non répartie : ${[...spread]}`);
});

test('job split-wordcount : 3 parts, merge exact vs oracle manuel', async () => {
  const text = 'alpha beta\ngamma\n\ndelta epsilon zeta\neta\ntheta iota kappa lambda';
  const oracle = {
    words: (text.match(/\S+/g) || []).length,
    lines: text.split('\n').length,
    chars: text.length,
  };
  const coord = launch('frag-wc', 48353, [
    '--peers', `127.0.0.1:${EXEC}`, ...COMMON,
    '--job', 'split-wordcount', '--job-params', JSON.stringify({ text, parts: 3 }),
  ]);
  const job = await waitFor(() => (coord.jobLines.length ? coord.jobLines[0] : null), { label: 'job wordcount' });
  assert.equal(job.outcome, 'done');
  assert.deepEqual(job.value, oracle);
  assert.equal(job.fragments.length, 3);
  assert.ok(job.fragments.every((f) => f.outcome === 'done'));
  assert.ok(spreadOf(job).has(await execId()), 'exécutant distant inutilisé');
});

test('job batch-fib : 3 fragments concurrents, valeurs exactes, 2 nœuds', async () => {
  const coord = launch('frag-fib', 48354, [
    '--peers', `127.0.0.1:${EXEC}`, ...COMMON,
    '--job', 'batch-fib', '--job-params', JSON.stringify({ ns: [20, 25, 30] }),
  ]);
  const job = await waitFor(() => (coord.jobLines.length ? coord.jobLines[0] : null), { label: 'job batch' });
  assert.equal(job.outcome, 'done');
  assert.deepEqual(job.value, [6765, 75025, 832040]);
  const spread = spreadOf(job);
  assert.ok(spread.has(await execId()), 'exécutant distant inutilisé');
  assert.ok(spread.size >= 2, `lot non réparti : ${[...spread]}`);
});

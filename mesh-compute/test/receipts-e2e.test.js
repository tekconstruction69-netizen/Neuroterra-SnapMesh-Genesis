'use strict';

/**
 * E2E §7 : faisceau de preuve sur job réel + distinction reçus/exactitude.
 * - batch-fib honnête : finalHash recomputé, reçus vérifiés, 2 nœuds.
 * - exécutant saboté (signatures VALIDES, valeurs fausses) : le job ÉCHOUE
 *   quand même par quorum — un reçu prouve l'imputabilité, pas l'exactitude.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
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
const D = ['--no-discovery'];
const COMMON = [...D, '--submit-delay-ms', '9000', '--submit-wait-peers', '1'];

function launch(name, tcpPort, extraArgs = []) {
  const child = spawn(process.execPath, [BIN, '--name', name, '--port', String(tcpPort), '--status-port', String(tcpPort + STATUS_GAP), '--quiet', ...extraArgs], {
    cwd: workdir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.jobLines = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const m = line.match(/^\[job\] (.*)$/);
      if (m) {
        try {
          child.jobLines.push(JSON.parse(m[1]));
        } catch {}
      }
    }
  });
  return child;
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

const sh = (o) => crypto.createHash('sha256').update(JSON.stringify(o), 'utf8').digest('hex');

test('faisceau e2e : batch honnête vérifiable hors-ligne', async () => {
  launch('pv-exec', 48372, D);
  const coord = launch('pv-coord', 48371, [
    '--peers', '127.0.0.1:48372', ...COMMON,
    '--job', 'batch-fib', '--job-params', JSON.stringify({ ns: [20, 25] }),
  ]);
  const job = await waitFor(() => (coord.jobLines.length ? coord.jobLines[0] : null), { label: 'job preuve' });
  assert.equal(job.outcome, 'done');
  assert.deepEqual(job.value, [6765, 75025]);
  // Re-vérification hors-ligne du faisceau (sans clé, que des empreintes).
  assert.equal(job.verification.finalHash, sh(job.value));
  assert.equal(job.verification.fragments.length, 2);
  const ns = [20, 25];
  job.verification.fragments.forEach((f, i) => {
    assert.equal(f.inHash, sh({ n: ns[i] }));
    assert.equal(f.outHash, sh(job.value[i]));
    assert.ok(f.receipts.length >= 1);
    assert.ok(f.receipts.every((r) => r.verified === true && typeof r.sig === 'string'));
  });
});

test('menteur signé : reçus valides mais valeurs fausses → job failed', async () => {
  // L'exécutant saboté signe des reçus PARFAITEMENT VALIDES sur des valeurs
  // falsifiées : le faisceau seul ne suffit pas, le quorum tranche.
  launch('pv-menteur', 48374, [...D, '--sabotage']);
  const coord = launch('pv-juge', 48373, [
    '--peers', '127.0.0.1:48374', ...COMMON,
    '--job', 'batch-fib', '--job-params', JSON.stringify({ ns: [20], redundancy: 2 }),
  ]);
  const job = await waitFor(() => (coord.jobLines.length ? coord.jobLines[0] : null), { label: 'job menteur' });
  assert.equal(job.outcome, 'failed', 'désaccord non détecté');
  assert.equal(job.fragments.length, 1);
  assert.equal(job.fragments[0].outcome, 'failed');
  assert.equal(job.verification, undefined, 'aucune preuve sur un échec');
});

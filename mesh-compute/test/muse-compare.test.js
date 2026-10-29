'use strict';

/**
 * Comparatif §6 mêmes-conditions : local / round-robin / capacity / muse.
 * Même charge (fib × 2, redondance 1), mêmes 2 nœuds, vrais processus.
 * Constatent : complétion + valeurs + makespans (rapportés, SANS allégation
 * de supériorité — O5 reste une hypothèse, §10 la mesurera).
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
const EXEC = 48360;
const SCHEDS = ['local', 'round-robin', 'capacity', 'muse'];

function launch(name, tcpPort, extraArgs = []) {
  const child = spawn(process.execPath, [BIN, '--name', name, '--port', String(tcpPort), '--status-port', String(tcpPort + STATUS_GAP), '--quiet', ...extraArgs], {
    cwd: workdir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.taskLines = [];
  child.planLines = [];
  child.allLines = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      child.allLines.push(line);
      let m = line.match(/^\[task\] (.*)$/);
      if (m) {
        try {
          child.taskLines.push(JSON.parse(m[1]));
        } catch {}
      }
      m = line.match(/^\[plan\] (.*)$/);
      if (m) child.planLines.push(m[1]);
    }
  });
  child.stderr.on('data', (d) => {
    child.allLines.push('[stderr] ' + d.toString().slice(0, 200));
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

test('comparatif : 4 ordonnanceurs, même charge, 2/2 done partout', async () => {
  launch('cmp-exec', EXEC, ['--no-discovery']);
  const coords = {};
  let port = 48361;
  for (const s of SCHEDS) {
    coords[s] = launch(`cmp-${s}`, port++, [
      '--peers', `127.0.0.1:${EXEC}`, '--no-discovery',
      '--scheduler', s,
      '--submit', 'fib', '--args', '{"n":25}', '--redundancy', '1',
      '--submit-count', '2', '--submit-delay-ms', '9000', '--submit-wait-peers', '1',
    ]);
  }
  const summary = {};
  for (const s of SCHEDS) {
    const res = await waitFor(() => (coords[s].taskLines.length >= 2 ? coords[s].taskLines : null), { label: `2 résultats ${s}` });
    assert.ok(res.every((r) => r.outcome === 'done'), `${s} : échec inattendu`);
    assert.ok(res.every((r) => r.value === 75025), `${s} : F(25) exacte exigée`);
    assert.ok(res.every((r) => typeof r.makespanMs === 'number'), `${s} : makespan mesuré exigé`);
    assert.ok(res.every((r) => r.scheduler === s), `${s} : ordonnanceur tracé dans le verdict`);
    summary[s] = {
      makespansMs: res.map((r) => r.makespanMs),
      attempts: res.map((r) => r.attempts),
    };
  }
  // L'ordonnanceur muse expose ses plans (heuristique validée, sans repli ici).
  assert.ok(coords.muse.planLines.length >= 2, 'plans muse absents');
  assert.ok(coords.muse.planLines.every((l) => l.startsWith('heuristic') && !l.includes('REPLI')), `repli inattendu : ${coords.muse.planLines}`);
  console.log(`[comparatif] ${JSON.stringify(summary)}`);
});

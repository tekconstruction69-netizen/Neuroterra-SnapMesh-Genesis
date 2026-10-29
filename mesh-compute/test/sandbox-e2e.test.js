'use strict';

/**
 * Test e2e §4 : timeout sandbox réel sur processus distant + reprise.
 * L'exécutant a un timeout sandbox de 1 ms : sa tâche expire silencieusement
 * (worker tué), le coordinateur réaffecte sur lui-même et tranche `done`.
 * Round-robin × 2 soumissions : chaque nœud reçoit exactement une tâche
 * (ordre indifférent), l'une des deux passe par la reprise (attempts ≥ 2).
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
const COORD = 48341;
const EXEC = 48342;

function launch(name, tcpPort, extraArgs = []) {
  const child = spawn(process.execPath, [BIN, '--name', name, '--port', String(tcpPort), '--status-port', String(tcpPort + STATUS_GAP), '--quiet', ...extraArgs], {
    cwd: workdir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.taskLines = [];
  child.allLines = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      child.allLines.push(line);
      const m = line.match(/^\[task\] (.*)$/);
      if (m) {
        try {
          child.taskLines.push(JSON.parse(m[1]));
        } catch {}
      }
    }
  });
  child.stderr.on('data', (d) => {
    child.allLines.push('[stderr] ' + d.toString().slice(0, 200));
  });
  return child;
}

async function waitFor(fn, { timeoutMs = 45000, label = 'condition' } = {}) {
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

test('sandbox e2e : timeout distant 1 ms puis reprise locale, 2/2 done', async () => {
  const D = ['--no-discovery'];
  const exec = launch('sbx-exec', EXEC, [...D, '--sandbox-timeout-ms', '1']);
  const coord = launch('sbx-coord', COORD, [
    '--peers', `127.0.0.1:${EXEC}`, ...D,
    '--scheduler', 'round-robin',
    '--submit', 'fib', '--args', '{"n":20}',
    '--redundancy', '1', '--submit-count', '2',
    '--submit-delay-ms', '9000', '--submit-wait-peers', '1',
  ]);

  const both = await waitFor(() => (coord.taskLines.length >= 2 ? coord.taskLines : null), { label: '2 résultats' });
  assert.equal(both.length, 2);
  for (const r of both) {
    assert.equal(r.outcome, 'done');
    assert.equal(r.value, 6765, 'vraie valeur de F(20)');
  }
  // Round-robin partagé avec les reprises : selon l'ordre des ids, les deux
  // tâches visitent l'exécutant ([2,2]) ou une seule ([1,2]). Dans tous les
  // cas, au moins une passe par timeout distant + reprise locale.
  const attempts = both.map((r) => r.attempts).sort();
  assert.ok(attempts.every((a) => a === 1 || a === 2), `tentatives aberrantes : ${attempts}`);
  assert.ok(attempts.some((a) => a >= 2), `aucune reprise après timeout distant : ${attempts}`);

  // L'exécutant distant a bien tué la tâche dans son sandbox (cause prouvée).
  const failedLine = await waitFor(() => exec.allLines.find((l) => l.startsWith('[exec-échoué]')), { label: 'exec-échoué distant' });
  assert.ok(failedLine.includes('sandbox-timeout'), `mauvaise cause : ${failedLine}`);

  // Le coordinateur a exécuté via son propre sandbox (au moins la reprise).
  assert.ok((both[0].sandbox?.done || 0) + (both[1].sandbox?.done || 0) >= 1, 'sandbox coordinateur inutilisé');
});

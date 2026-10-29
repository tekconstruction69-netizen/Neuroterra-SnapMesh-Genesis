'use strict';

/**
 * Test e2e NT-Flux §7 : 2 processus `compute-node` réels (TCP local).
 * - Coordinateur (--flux --no-self) soumet 2× le même gros wordcount.
 * - 1re tâche : pleine (flux compressé) ; 2e : ref 64 octets (dedup).
 * - Preuves : verdicts `done` exacts (oracle indépendant), exécutant
 *   distant (agreeing), logs `[flux] send` (plein puis ref) côté
 *   coordinateur et `[flux] recv` côté exécutant.
 * Ports isolés 48411/48412 (+500 statut).
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

const EXEC = 48412;

function launch(name, tcpPort, extraArgs = []) {
  const child = spawn(process.execPath, [BIN, '--name', name, '--port', String(tcpPort), '--status-port', String(tcpPort + 500), '--quiet', ...extraArgs], {
    cwd: workdir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.taskLines = [];
  child.fluxLines = [];
  child.execLines = [];
  child.allLines = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      child.allLines.push(line);
      let m = line.match(/^\[task\] (.*)$/) || line.match(/^\[job\] (.*)$/);
      if (m) {
        try {
          child.taskLines.push(JSON.parse(m[1]));
        } catch {}
      }
      m = line.match(/^\[flux\] (.*)$/);
      if (m) child.fluxLines.push(m[1]);
      m = line.match(/^\[exec\] (.*)$/);
      if (m) child.execLines.push(m[1]);
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
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`timeout (${timeoutMs} ms) : ${label}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

function statusOf(tcpPort) {
  return new Promise((resolve, reject) => {
    const req = require('node:http').get(`http://127.0.0.1:${tcpPort + 500}/status`, (res) => {
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

test('e2e flux : 2 processus, pleine puis ref, verdicts exacts distants', async () => {
  launch('flux-exec', EXEC, ['--no-discovery', '--flux']);
  // ~50 Ko très compressible (seuil ~2 Ko) : le fil doit porter du flux.
  const text = 'ligne de texte compressible pour NT-Flux 0123456789\n'.repeat(1000);
  assert.ok(text.length > 2048 && text.length <= 64 * 1024, `taille texte: ${text.length}`);
  const oracle = {
    words: (text.match(/\S+/g) || []).length,
    lines: text.split('\n').length,
    chars: text.length,
  };
  // argv Windows ~32 Ko : les args transitent par fichier (--args-file).
  const argsFile = path.join(workdir, 'flux-args.json');
  fs.writeFileSync(argsFile, JSON.stringify({ text }));
  const coord = launch('flux-coord', 48411, [
    '--peers', `127.0.0.1:${EXEC}`,
    '--no-discovery', '--submit-delay-ms', '9000', '--submit-wait-peers', '1',
    '--flux', '--no-self',
    '--submit', 'wordcount', '--args-file', argsFile,
    '--submit-count', '2', '--redundancy', '1',
  ]);
  const both = await waitFor(() => (coord.taskLines.length >= 2 ? coord.taskLines : null), { label: '2 verdicts tâche' });
  for (const [i, t] of both.entries()) {
    assert.equal(t.outcome, 'done', `tâche ${i} : ${JSON.stringify(t).slice(0, 300)}`);
    assert.deepEqual(t.value, oracle, `tâche ${i} : valeur inexacte`);
  }
  // Exécution réellement distante : l'exécutant a vu 2 exec, le
  // coordinateur a placé sur le pair (agreeing ≠ soi).
  const execId = await waitFor(async () => {
    try {
      return (await statusOf(EXEC)).self.id;
    } catch {
      return null;
    }
  }, { label: 'statut exécutant' });
  for (const [i, t] of both.entries()) {
    assert.ok((t.agreeing || []).includes(execId), `tâche ${i} non exécutée à distance`);
  }
  // Fil prouvé : 1er envoi plein (flux compressé), 2e en ref 64 octets.
  const sends = coord.fluxLines.filter((l) => l.startsWith('send'));
  assert.ok(sends.length >= 2, `pas de stats send flux : ${JSON.stringify(coord.fluxLines)}`);
  assert.match(sends[0], /^send (flux|plein) /, `1er envoi non plein : ${sends[0]}`);
  assert.match(sends[1], /^send ref none \d+->64$/, `2e envoi non ref : ${sends[1]}`);
  // Côté exécutant : 2 réceptions (flux puis ref), 2 exécutions.
  const execNode = children[0];
  const recvs = execNode.fluxLines.filter((l) => l.startsWith('recv'));
  assert.ok(recvs.length >= 2, `pas de stats recv flux : ${JSON.stringify(execNode.fluxLines)}`);
  assert.match(recvs[0], /^recv flux /, `1re réception non flux : ${recvs[0]}`);
  assert.match(recvs[1], /^recv ref /, `2e réception non ref : ${recvs[1]}`);
  assert.ok(execNode.execLines.length >= 2, 'exécutant : 2 exécutions attendues');
});

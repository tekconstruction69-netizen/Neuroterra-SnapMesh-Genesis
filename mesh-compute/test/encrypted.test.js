'use strict';

/**
 * Test e2e §3 : TASK/RESULT chiffrés (X25519 + AES-256-GCM) entre vrais
 * processus `compute-node`, avec capture du fil via proxy TCP.
 * Preuves : tâche réussie + octets du fil sans secret en clair.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'compute-node.js');
const children = [];
const taps = [];
after(() => {
  for (const c of children) {
    try {
      c.kill('SIGKILL');
    } catch {}
  }
  for (const t of taps) {
    try {
      t.server.close();
    } catch {}
  }
});

const workdir = path.join(__dirname, '.tmp-int');
fs.mkdirSync(workdir, { recursive: true });

const STATUS_GAP = 500;
const COORD = 48331;
const EXEC = 48332;
const PROXY = 48333;
const CANARY = 'canari-snapmesh-7f3a2b-transport';

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

/** Proxy TCP transparent qui enregistre les octets des deux sens. */
function tapProxy(listenPort, targetPort) {
  const up = []; // coordinateur -> exécutant (TASK)
  const down = []; // exécutant -> coordinateur (RESULT)
  const server = net.createServer((client) => {
    const target = net.connect(targetPort, '127.0.0.1');
    client.on('data', (c) => {
      up.push(Buffer.from(c));
      target.write(c);
    });
    target.on('data', (c) => {
      down.push(Buffer.from(c));
      client.write(c);
    });
    const close = () => {
      try {
        client.destroy();
      } catch {}
      try {
        target.destroy();
      } catch {}
    };
    client.on('error', close);
    target.on('error', close);
    client.on('close', close);
    target.on('close', close);
  });
  return new Promise((resolve) => server.listen(listenPort, '127.0.0.1', () => resolve({
    server,
    bytesUp: () => Buffer.concat(up).toString('utf8'),
    bytesDown: () => Buffer.concat(down).toString('utf8'),
  })));
}

async function waitFor(fn, { timeoutMs = 30000, label = 'condition' } = {}) {
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

test('TASK/RESULT chiffrés : succès + secret absent du fil (proxy)', async () => {
  const tap = await tapProxy(PROXY, EXEC);
  taps.push(tap); // fermeture garantie même sur échec (sinon le runner reste pendu)
  const D = ['--no-discovery'];
  const exec = launch('enc-exec', EXEC, D);
  // Le coordinateur ne connaît que le proxy : tout son trafic passe sous écoute.
  const coord = launch(
    'enc-coord',
    COORD,
    ['--peers', `127.0.0.1:${PROXY}`, ...D, '--submit', 'sha256-hex', '--args', JSON.stringify({ text: CANARY }),
      '--redundancy', '2', '--submit-delay-ms', '9000', '--submit-wait-peers', '1']
  );

  const expected = crypto.createHash('sha256').update(CANARY, 'utf8').digest('hex');
  const res = await waitFor(() => (coord.taskLines.length ? coord.taskLines[0] : null), { label: 'résultat tâche' });
  assert.equal(res.outcome, 'done');
  assert.equal(res.value, expected, 'le résultat déchiffré doit être le vrai sha256');

  // L'exécutant distant a bien travaillé, sur une tâche arrivée chiffrée.
  const execLine = await waitFor(() => exec.allLines.find((l) => /^\[exec\] sha256-hex/.test(l)), { label: 'exec distant' });
  assert.ok(execLine.includes('chiffré=1'), `TASK arrivé en clair : ${execLine}`);

  // Le coordinateur a reçu au moins un RESULT chiffré.
  assert.ok((res.resultatsChiffres || 0) >= 1, `aucun RESULT chiffré compté : ${JSON.stringify(res)}`);

  // Le fil ne contient ni le secret ni son empreinte en clair.
  await new Promise((r) => setTimeout(r, 500)); // laisse le proxy vider ses tampons
  const up = tap.bytesUp();
  const down = tap.bytesDown();
  assert.ok(up.includes('ENCRYPTED'), 'aucune enveloppe ENCRYPTED vers le pair exécutant');
  assert.ok(down.includes('ENCRYPTED'), 'aucune enveloppe ENCRYPTED vers le coordinateur');
  assert.ok(!up.includes(CANARY), 'FUITE : secret en clair vers le pair exécutant');
  assert.ok(!down.includes(CANARY), 'FUITE : secret en clair vers le coordinateur');
  assert.ok(!down.includes(expected), 'FUITE : résultat en clair vers le coordinateur');

  tap.server.close();
});

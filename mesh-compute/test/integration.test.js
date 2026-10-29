'use strict';

/**
 * Tests d'intégration M2 : vrais processus `compute-node` sur loopback.
 * Distribution réelle, quorum 2/3, fraude, kill en cours de tâche,
 * timeout + réaffectation. Chaque résultat est une valeur vérifiée.
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

const STATUS_GAP = 500; // statut loin des ports TCP (+100 réservé à l'usage réel)

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
      if (line.startsWith('[submit]')) child.submitted = true;
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

async function waitForLine(child, re, { timeoutMs = 20000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const hit = child.allLines.find((l) => re.test(l));
    if (hit) return hit;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout ligne ${re}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function waitFor(fn, { timeoutMs = 20000, label = 'condition' } = {}) {
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

test('distribution + quorum : fib(25) redondance 3, accord unanime', async () => {
  const D = ['--discovery-port', '47831'];
  launch('q-a', 48211, ['--submit', 'fib', '--args', '{"n":25}', '--redundancy', '3', ...D]);
  launch('q-b', 48212, D);
  launch('q-c', 48213, D);
  const a = children[children.length - 3];
  const res = await waitFor(() => (a.taskLines.length ? a.taskLines[0] : null), { label: 'résultat quorum' });
  assert.equal(res.outcome, 'done');
  assert.equal(res.value, 75025); // vraie valeur de F(25)
  assert.equal(res.agreeing.length, 3);
  assert.deepEqual(res.dissenting, []);
});

test('fraude 2-contre-1 : le menteur est écarté et signalé', async () => {
  const D = ['--discovery-port', '47832'];
  launch('f-a', 48221, ['--submit', 'primes', '--args', '{"max":1000}', '--redundancy', '3', ...D]);
  launch('f-b', 48222, ['--sabotage', ...D]);
  launch('f-c', 48223, D);
  const a = children[children.length - 3];
  const res = await waitFor(() => (a.taskLines.length ? a.taskLines[0] : null), { label: 'résultat anti-fraude' });
  assert.equal(res.outcome, 'done');
  assert.deepEqual(res.value, { count: 168 }); // vrais premiers ≤ 1000 : 168
  assert.equal(res.agreeing.length, 2);
  assert.equal(res.dissenting.length, 1);
  assert.deepEqual(res.fraudSuspects, res.dissenting);
});

test('panne en cours de tâche : kill d\'un exécutant, quorum à 2 quand même', async () => {
  const D = ['--discovery-port', '47833'];
  launch('k-a', 48231, ['--submit', 'sha256-hex', '--args', '{"text":"snapmesh"}', '--redundancy', '2', '--task-timeout-ms', '3000', ...D]);
  launch('k-b', 48232, D);
  const c = launch('k-c', 48233, D);
  const a = children[children.length - 3];
  await waitFor(() => (a.submitted ? true : null), { label: 'tâche dispatchée' });
  await new Promise((r) => setTimeout(r, 500));
  c.kill('SIGKILL'); // panne brutale pendant l'exécution
  const res = await waitFor(() => (a.taskLines.length ? a.taskLines[0] : null), { label: 'résultat malgré panne' });
  assert.equal(res.outcome, 'done');
  const expected = require('node:crypto').createHash('sha256').update('snapmesh').digest('hex');
  assert.equal(res.value, expected); // oracle indépendant (crypto direct, hors maillage)
  assert.ok(res.agreeing.length >= 1);
});

test('timeout + réaffectation : le mort est remplacé, tout finit done', async () => {
  const D = ['--discovery-port', '47834'];
  launch('r-a', 48241, ['--submit', 'fib', '--args', '{"n":20}', '--redundancy', '1', '--submit-count', '2', '--task-timeout-ms', '3000', ...D]);
  const b = launch('r-b', 48242, D);
  const a = children[children.length - 2];
  await new Promise((r) => setTimeout(r, 1000));
  b.kill('SIGKILL'); // B meurt avant soumission : une des 2 tâches le visera
  const both = await waitFor(() => (a.taskLines.length === 2 ? a.taskLines : null), { timeoutMs: 25000, label: '2 tâches terminées' });
  assert.ok(both.every((t) => t.outcome === 'done' && t.value === 6765));
  const attempts = both.reduce((n, t) => n + t.attempts, 0);
  assert.ok(attempts >= 3, `réaffectation attendue (tentatives=${attempts})`);
});

test('redondance 1 + sabotage : re-calcul local, échec et suspect nommé', async () => {
  const D = ['--discovery-port', '47835'];
  launch('s-a', 48251, ['--submit', 'fib', '--args', '{"n":10}', '--redundancy', '1', '--submit-count', '2', ...D]);
  launch('s-b', 48252, ['--sabotage', ...D]);
  const a = children[children.length - 2];
  const both = await waitFor(() => (a.taskLines.length === 2 ? a.taskLines : null), { label: '2 verdicts redondance 1' });
  const done = both.filter((t) => t.outcome === 'done');
  const failed = both.filter((t) => t.outcome === 'failed');
  assert.equal(done.length, 1);
  assert.equal(done[0].value, 55); // F(10) réel
  assert.equal(failed.length, 1);
  assert.equal(failed[0].fraudSuspects.length, 1);
  assert.notEqual(failed[0].fraudSuspects[0], done[0].agreeing[0]);
});

test('menteur : résultat écarté + pair signalé, mais pair NON exclu du réseau', async () => {
  // Le verdict f-* prouve l'écart ; ici on prouve que le menteur reste connecté
  // (aucune exclusion automatique en M2 — exclusion = [PRÉVU] M4).
  const s = await statusOf(48221).catch(() => null);
  assert.ok(s, 'coordinateur f-a injoignable : rejouer la suite complète');
  const liar = s.peers.find((p) => p.name === 'f-b');
  assert.ok(liar, 'menteur f-b absent du registre');
  assert.equal(liar.state, 'connected', 'le menteur ne doit pas être exclu en M2');
});

test('panne silencieuse synchronisée : kill sur [exec] observé, réaffectation', async () => {
  const D = ['--discovery-port', '47836'];
  const a = launch('d-a', 48261, ['--submit', 'fib', '--args', '{"n":19}', '--redundancy', '1', '--submit-count', '2', '--task-timeout-ms', '2500', ...D]);
  const b = launch('d-b', 48262, ['--drop-results', ...D]);
  // Synchronisation sur affectation OBSERVÉE (pas un délai arbitraire).
  await waitForLine(b, /^\[exec\] fib/, { timeoutMs: 20000 });
  b.kill('SIGKILL'); // panne pendant l'exécution, avant toute réponse (aucune ne viendra)
  const both = await waitFor(() => (a.taskLines.length === 2 ? a.taskLines : null), { timeoutMs: 25000, label: '2 tâches après kill' });
  assert.ok(both.every((t) => t.outcome === 'done' && t.value === 4181));
  const attempts = both.reduce((n, t) => n + t.attempts, 0);
  assert.ok(attempts >= 3, `réaffectation attendue (tentatives=${attempts})`);
});

test('sans exécutant : redondance inatteignable, échec franc sans blocage', async () => {
  const D = ['--discovery-port', '47837'];
  const a = launch('n-a', 48263, ['--submit', 'fib', '--args', '{"n":10}', '--redundancy', '2', '--submit-wait-peers', '0', ...D]);
  const res = await waitFor(() => (a.taskLines.length ? a.taskLines[0] : null), { timeoutMs: 15000, label: 'échec franc' });
  assert.equal(res.outcome, 'failed');
  assert.equal(res.value, null);
});

test('reprise coordinateur : arrêt brutal puis redémarrage, tâche terminée', async () => {
  const D = ['--discovery-port', '47838'];
  const Q = ['--queue-file', './vq-a.queue.json'];
  try { fs.unlinkSync(path.join(workdir, 'vq-a.queue.json')); } catch {}
  const base = ['--submit', 'fib', '--args', '{"n":25}', '--redundancy', '2', '--task-timeout-ms', '15000', '--submit-delay-ms', '2500', '--recover-delay-ms', '4000', ...D, ...Q];
  let a = launch('v-a', 48264, base);
  launch('v-b', 48265, D);
  launch('v-c', 48266, D);
  await waitFor(async () => (await statusOf(48264)).peers.length === 2, { timeoutMs: 15000, label: 'maillage v' });
  // Fait tomber les exécutants pendant le délai de soumission : la tâche
  // partira avec des candidats périmés et restera en vol (timeout 15 s).
  children[children.length - 2].kill('SIGKILL');
  children[children.length - 1].kill('SIGKILL');
  await waitFor(() => (a.submitted ? true : null), { label: 'tâche v dispatchée' });
  await new Promise((r) => setTimeout(r, 2000));
  a.kill('SIGKILL'); // arrêt brutal du coordinateur, tâche en vol
  // Redémarrage à l'identique (même clé, même file) SANS resoumettre ;
  // les exécutants reviennent aussi.
  a = launch('v-a', 48264, ['--recover-delay-ms', '4000', ...D, ...Q]);
  launch('v-b', 48265, D);
  launch('v-c', 48266, D);
  await waitForLine(a, /^\[reprise\] [1-9]/, { timeoutMs: 25000 });
  const res = await waitFor(() => (a.taskLines.length ? a.taskLines[0] : null), { timeoutMs: 25000, label: 'tâche reprise terminée' });
  assert.equal(res.outcome, 'done');
  assert.equal(res.value, 75025);
  assert.ok(res.attempts >= 3, `tentatives cumulées conservées (tentatives=${res.attempts})`);
  assert.equal(res.recovered, true);
});

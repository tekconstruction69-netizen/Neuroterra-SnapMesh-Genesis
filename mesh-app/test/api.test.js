'use strict';

/** Tests M2-SAFETY app : serveur réel en boucle locale + garde-fou STOP. */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 48799;
const BASE = `http://127.0.0.1:${PORT}`;
let server = null;
const children2 = [];

let TOKEN = null; // jeton local lu sur stdout du serveur (P2)
async function api(method, p, body, { token = TOKEN, origin = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Genesis-Token'] = token;
  if (origin) headers.Origin = origin;
  const r = await fetch(BASE + p, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null), text: await r.text().catch(() => '') };
}

test('serveur : démarrage, état initial arrêté, page servie', async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--port', String(PORT), '--mesh-port', '48311', '--status-port', '48411', '--ephemeral'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  server.stdout.on('data', (d) => {
    out += d.toString();
    const m = out.match(/\[auth\] jeton local : ([0-9a-f]{48})/);
    if (m) TOKEN = m[1];
  });
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(BASE + '/api/state');
      if (r.status === 200 && TOKEN) break;
    } catch {}
    if (Date.now() - t0 > 20000) throw new Error('serveur non démarré (ou jeton manquant)');
    await new Promise((r) => setTimeout(r, 250));
  }
  const html = await (await fetch(BASE + '/')).text();
  assert.ok(html.includes('DÉMARRER') && html.includes('consens'), 'page START/STOP servie en français');
  const st = await (await fetch(BASE + '/api/state')).json();
  assert.equal(st.safety.state, 'STOPPED');
  assert.ok(st.mesh.self.id.length === 64);
});

test('START exige consentement, puis STOP confirme', async () => {
  let r = await api('POST', '/api/start', {});
  assert.equal(r.json.state, 'ERROR');
  r = await api('POST', '/api/start', { consent: true });
  assert.equal(r.json.state, 'ACTIVE');
  r = await api('POST', '/api/mode', { mode: 'performance' });
  assert.equal(r.json.targets.cpuTarget, 0.1);
  r = await api('POST', '/api/mode', { mode: 'turbo' });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/stop', { reason: 'test' });
  assert.equal(r.json.stopped, true);
  const st = await (await fetch(BASE + '/api/state')).json();
  assert.equal(st.safety.state, 'STOPPED');
});

test('P2 : sans jeton 401, Origin tierce 403, corps énorme 413', async () => {
  let r = await api('POST', '/api/mode', { mode: 'eco' }, { token: null });
  assert.equal(r.status, 401, 'POST sans jeton accepté');
  assert.match(r.json.error, /jeton/);
  r = await api('POST', '/api/mode', { mode: 'eco' }, { token: 'faux' });
  assert.equal(r.status, 401, 'faux jeton accepté');
  r = await api('POST', '/api/mode', { mode: 'eco' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403, 'Origin tierce acceptée');
  assert.match(r.json.error, /origine/);
  const big = 'x'.repeat(300 * 1024);
  r = await api('POST', '/api/mode', { mode: 'eco', pad: big });
  assert.equal(r.status, 413, 'corps énorme accepté');
  // Légitime : jeton + Origin locale passent (état vérifié ailleurs).
  r = await api('POST', '/api/mode', { mode: 'eco' }, { origin: `http://127.0.0.1:${PORT}` });
  assert.equal(r.status, 200, `légitime refusé : ${r.status}`);
  r = await api('POST', '/api/mode', { mode: 'balanced' });
  assert.equal(r.status, 200);
});

test('garde-fou : TASK refusée quand STOPPED (pas de contournement)', async () => {
  const { EventEmitter } = require('node:events');
  const { SafetyController } = require('snapmesh-mesh-safety');
  const { SafetyGate } = require('snapmesh-mesh-safety/src/gate');
  const { ComputeNode } = require('snapmesh-mesh-compute');
  const controller = new SafetyController({});
  const gate = new SafetyGate(controller);
  const stub = new EventEmitter();
  stub.id = 'coord-test';
  stub.registry = { live: () => [] };
  stub.caps = () => ({ cpus: 2 });
  stub._sendTo = () => true;
  let refused = 0;
  stub.on('exec-refused', () => refused++);
  let executed = 0;
  stub.on('exec', () => executed++);
  const cn = new ComputeNode(stub, {
    admit: (op) => gate.admitRemote(op, 0, require('snapmesh-mesh-safety/src/telemetry').injectTelemetry()).granted,
  });
  void cn;
  // STOPPED : refusé, rien n'est exécuté.
  stub.emit('message', { type: 'TASK', from: 'quelquun', payload: { v: 1, taskId: 't-1', op: 'fib', args: { n: 5 } } });
  assert.equal(executed, 0);
  assert.equal(refused, 1);
});

test('déconnexion réseau réelle : SUSPENDED puis reprise à la reconnexion', async () => {
  const PORT2 = 48801;
  const BASE2 = `http://127.0.0.1:${PORT2}/`;
  const DISC = ['--discovery-port', '47851'];
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--port', String(PORT2), '--mesh-port', '48331', '--status-port', '48431', '--ephemeral', '--mesh-grace-ms', '1500', ...DISC], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children2.push(srv);
  let tok2 = null;
  let out2 = '';
  srv.stdout.on('data', (d) => {
    out2 += d.toString();
    const m = out2.match(/\[auth\] jeton local : ([0-9a-f]{48})/);
    if (m) tok2 = m[1];
  });
  const st2 = async () => (await (await fetch(BASE2 + 'api/state')).json());
  const t0 = Date.now();
  for (;;) {
    try {
      const s = await st2();
      if (s.safety && tok2) break;
    } catch {}
    if (Date.now() - t0 > 20000) throw new Error('serveur2 non démarré (ou jeton manquant)');
    await new Promise((r) => setTimeout(r, 250));
  }
  await fetch(BASE2 + 'api/start', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Genesis-Token': tok2 }, body: JSON.stringify({ consent: true }) });
  const MESH_BIN = path.join(__dirname, '..', '..', 'mesh-net', 'bin', 'snapmesh-node.js');
  const peerArgs = ['--name', 'peer-disc', '--port', '48332', '--ephemeral', '--quiet', ...DISC];
  let peer = spawn(process.execPath, [MESH_BIN, ...peerArgs], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
  children2.push(peer);
  const waitState = async (want, timeoutMs, label) => {
    const t1 = Date.now();
    for (;;) {
      try {
        const s = await st2();
        if (s.mesh.peers.length >= 1 && want === 'MESH') return s;
        if (s.safety.state === want) return s;
      } catch {}
      if (Date.now() - t1 > timeoutMs) throw new Error(`timeout : ${label}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  await waitState('MESH', 20000, 'pair maillé vu');
  peer.kill('SIGKILL'); // déconnexion brutale du maillage
  const susp = await waitState('SUSPENDED', 25000, 'suspension sur perte réseau');
  assert.match(susp.safety.reason, /réseau/);
  assert.equal(susp.safety.meshSuspended, true);
  peer = spawn(process.execPath, [MESH_BIN, ...peerArgs], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
  children2.push(peer);
  const back = await waitState('ACTIVE', 25000, 'reprise au retour réseau');
  assert.equal(back.safety.meshSuspended, false);
});

after(() => {
  try { server && server.kill('SIGKILL'); } catch {}
  for (const c of children2) {
    try { c.kill('SIGKILL'); } catch {}
  }
});

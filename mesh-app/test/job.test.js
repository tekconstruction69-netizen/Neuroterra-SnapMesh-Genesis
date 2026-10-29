'use strict';

/**
 * Tests §§8-9 app : frein safety, capsExtra live, job bout-en-bout par HTTP.
 * Serveur app réel + 1 nœud compute réel (découverte isolée).
 * Chaîne prouvée : POST /api/job → fragments → placement → exécution →
 * vérification → réponse, avec faisceau re-vérifié hors-ligne.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');

const PORT = 48798;
const BASE = `http://127.0.0.1:${PORT}`;
const MESH = 48381;
const STATUS = 48481;
const DISC = '47861';
const EXEC = 48382;
const children = [];
after(() => {
  for (const c of children) {
    try {
      c.kill('SIGKILL');
    } catch {}
  }
});

let TOKEN = null; // jeton local du serveur (P2)
function launchServer(args) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), ...args], {
    cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => {
    out += d.toString();
    const m = out.match(/\[auth\] jeton local : ([0-9a-f]{48})/);
    if (m) TOKEN = m[1];
  });
  return child;
}

async function api(method, p, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'X-Genesis-Token': TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
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

test('app : job refusé 409 quand STOPPED (frein orchestrateur)', async () => {
  launchServer(['--port', String(PORT), '--mesh-port', String(MESH), '--status-port', String(STATUS), '--ephemeral', '--discovery-port', DISC]);
  await waitFor(async () => (await fetch(BASE + '/api/state').then((r) => (r.status === 200 && TOKEN ? true : null)).catch(() => null)), { label: 'serveur app (+jeton)' });
  const st = (await api('GET', '/api/state')).json;
  assert.equal(st.safety.state, 'STOPPED');
  assert.ok(st.profile.ntId.length === 64, 'profil NT-ID exposé');
  assert.ok((st.caps.self.cpu.threads || 0) >= 1, 'capacités propres exposées');
  const r = await api('POST', '/api/job', { preset: 'batch-fib', params: { ns: [20] } });
  assert.equal(r.status, 409, 'job accepté sans contribution');
  assert.match(r.json.error, /STOPPED/);
});

test('app : job bout-en-bout via HTTP avec faisceau vérifié', async () => {
  children.push(spawn(process.execPath, [path.join(__dirname, '..', '..', 'mesh-compute', 'bin', 'compute-node.js'), '--name', 'app-exec', '--port', String(EXEC), '--status-port', String(EXEC + 500), '--quiet', '--discovery-port', DISC], {
    cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  let r = await api('POST', '/api/start', { consent: true });
  assert.equal(r.json.state, 'ACTIVE');
  // Le pair doit être maillé ET à session vérifiée (sinon pas candidat).
  const st = await waitFor(async () => {
    const s = (await api('GET', '/api/state')).json;
    const p = (s.caps.peers || [])[0];
    return p && p.sessionVerified ? s : null;
  }, { label: 'pair vérifié' });
  assert.ok(st.graph.nodes.length >= 2, 'graphe alimenté par télémétrie réelle');
  assert.ok(st.graph.links.length >= 1, 'lien réel observé');
  // Chaîne complète : requête → fragments → placement → exécution → réponse.
  r = await api('POST', '/api/job', { preset: 'batch-fib', params: { ns: [20, 25] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.outcome, 'done');
  assert.deepEqual(r.json.value, [6765, 75025]);
  const sh = (o) => crypto.createHash('sha256').update(JSON.stringify(o), 'utf8').digest('hex');
  assert.equal(r.json.verification.finalHash, sh(r.json.value), 'faisceau incohérent');
  assert.ok(r.json.verification.fragments.every((f) => f.receipts.length >= 1 && f.receipts.every((x) => x.verified)));
  // L'état expose le job (réponse persistée, pas de promesse).
  const st2 = (await api('GET', '/api/state')).json;
  assert.ok((st2.jobs || []).some((j) => j.outcome === 'done' && j.verification.finalHash === r.json.verification.finalHash));
  // STOP : le frein se referme (nouveau job refusé).
  r = await api('POST', '/api/stop', { reason: 'test' });
  assert.equal(r.json.stopped, true);
  const r2 = await api('POST', '/api/job', { preset: 'batch-fib', params: { ns: [20] } });
  assert.equal(r2.status, 409);
});

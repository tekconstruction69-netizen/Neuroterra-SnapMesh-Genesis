'use strict';

/**
 * Frontend réel (public/app.js) exécuté dans node:vm, sans dépendance :
 * DOM minimal + espions fetch/EventSource/timers.
 * - Démo statique (placeholder) : zéro appel réseau, contrôles désactivés.
 * - Mode local (jeton 48 hex) : START/STOP authentifiés par l'en-tête.
 * Aucun jeton réel n'est journalisé.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const FAKE_TOKEN = 'a'.repeat(48);

class El {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.title = '';
    this.dataset = {};
    this.children = [];
    this.firstChild = null;
    this._listeners = {};
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c),
    };
  }
  addEventListener(name, fn) { (this._listeners[name] ||= []).push(fn); }
  async click() { for (const fn of this._listeners.click || []) await fn(); }
  appendChild(c) { this.children.push(c); this.firstChild = this.children[0] || null; return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); this.firstChild = this.children[0] || null; return c; }
  setAttribute() {}
}

function makeDom() {
  const byId = new Map();
  const modes = ['eco', 'balanced', 'performance'].map((m) => {
    const b = new El('button');
    b.dataset.mode = m;
    return b;
  });
  const document = {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, new El(id === 'toggle' || id === 'job-run' ? 'button' : 'div'));
      return byId.get(id);
    },
    querySelectorAll(sel) { return sel === '.modes button' ? modes : []; },
    createElementNS(_ns, tag) { return new El(tag); },
  };
  return { document, byId, modes };
}

function stateFixture(state = 'STOPPED') {
  return {
    safety: { state, reason: '', mode: 'balanced', measuredCpu: 0, targets: { cpuTarget: 0.05 }, activeTasks: 0, thermal: 'NORMAL' },
    telemetry: { totalMem: 16 * 2 ** 30, freeMem: 8 * 2 ** 30 },
    mesh: { peers: [] },
    results: [],
    profile: { ntId: 'b'.repeat(64), name: 'app-local', brake: { go: false, reason: 'STOPPED' } },
    caps: { self: { cpu: { arch: 'x64', threads: 4 }, ram: { free: 8 * 2 ** 30 } }, peers: [] },
    graph: { nodes: [{ id: 'b'.repeat(64), name: 'app-local', self: true }], links: [] },
    jobs: [],
  };
}

function loadApp({ token, fetchImpl }) {
  const { document, byId, modes } = makeDom();
  const calls = { fetch: [], eventSource: 0, intervals: 0 };
  const window = {};
  if (token !== undefined) window.__GENESIS_TOKEN__ = token;
  const sandbox = {
    window,
    document,
    navigator: {},
    location: { protocol: 'http:', hostname: '127.0.0.1' },
    console,
    setInterval: () => { calls.intervals++; return 1; },
    clearInterval: () => {},
    fetch: async (url, opts = {}) => {
      calls.fetch.push({ url: String(url), opts });
      return fetchImpl(url, opts);
    },
    EventSource: class {
      constructor(url) { calls.eventSource++; this.url = url; }
      close() {}
    },
  };
  window.window = window;
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  return { calls, byId, modes, document };
}

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const neverFetch = async () => { throw new Error('fetch interdit en démo'); };

test('démo statique (placeholder) : zéro réseau, contrôles désactivés', async () => {
  const { calls, byId, modes, document } = loadApp({ token: '__GENESIS_TOKEN__', fetchImpl: neverFetch });
  await flush();
  assert.equal(calls.fetch.length, 0, 'fetch appelé en démo');
  assert.equal(calls.eventSource, 0, 'EventSource ouvert en démo');
  assert.equal(calls.intervals, 0, 'polling démarré en démo');
  assert.match(byId.get('mode-title').textContent, /Démonstration statique/);
  assert.match(byId.get('state').textContent, /démonstration statique/);
  assert.equal(document.getElementById('toggle').disabled, true);
  assert.equal(document.getElementById('job-run').disabled, true);
  assert.ok(modes.every((b) => b.disabled), 'modes actifs en démo');
  assert.equal(document.getElementById('r-cpu').textContent || '—', '—');
  // Même un clic forcé sur le bouton désactivé ne doit rien appeler.
  await document.getElementById('toggle').click();
  await flush();
  assert.equal(calls.fetch.length, 0, 'fetch appelé après clic en démo');
});

test('démo statique (jeton absent) : zéro réseau', async () => {
  const { calls, document } = loadApp({ token: undefined, fetchImpl: neverFetch });
  await flush();
  assert.equal(calls.fetch.length, 0);
  assert.equal(calls.eventSource, 0);
  assert.equal(calls.intervals, 0);
  assert.equal(document.getElementById('toggle').disabled, true);
});

test('mode local : START puis STOP authentifiés par en-tête', async () => {
  let current = stateFixture('STOPPED');
  const fetchImpl = async (url) => ({
    json: async () => (String(url) === '/api/state' ? current : {}),
  });
  const { calls, byId, document } = loadApp({ token: FAKE_TOKEN, fetchImpl });
  await flush();
  assert.match(byId.get('mode-title').textContent, /Mode local authentifié/);
  const toggle = document.getElementById('toggle');
  assert.equal(toggle.disabled, false, 'contrôle local resté désactivé');
  assert.ok(calls.fetch.some((c) => c.url === '/api/state'), 'état local non lu');
  assert.equal(calls.eventSource, 1, 'SSE local non ouvert');

  document.getElementById('consent').checked = true;
  const beforeStart = calls.fetch.length;
  await toggle.click();
  const start = calls.fetch.slice(beforeStart).find((c) => c.url === '/api/start');
  assert.ok(start, 'START non émis');
  assert.equal(start.opts.method, 'POST');
  assert.equal(start.opts.headers['X-Genesis-Token'], FAKE_TOKEN);
  assert.deepEqual(JSON.parse(start.opts.body), { consent: true });

  current = stateFixture('ACTIVE');
  const beforeStop = calls.fetch.length;
  await toggle.click();
  const stop = calls.fetch.slice(beforeStop).find((c) => c.url === '/api/stop');
  assert.ok(stop, 'STOP non émis');
  assert.equal(stop.opts.headers['X-Genesis-Token'], FAKE_TOKEN);
});

test('mode local : échec réseau des commandes capturé sans rejet', async () => {
  let failCommands = false;
  const fetchImpl = async (url) => {
    if (failCommands && String(url) !== '/api/state') throw new Error('coupé');
    if (failCommands && String(url) === '/api/state') throw new Error('coupé');
    return { json: async () => stateFixture('STOPPED') };
  };
  const { byId, document } = loadApp({ token: FAKE_TOKEN, fetchImpl });
  await flush();
  document.getElementById('consent').checked = true;
  failCommands = true;
  await document.getElementById('toggle').click(); // ne doit pas rejeter
  assert.match(byId.get('reason').textContent, /Commande locale échouée/);
});

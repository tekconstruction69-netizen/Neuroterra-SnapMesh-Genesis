'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { GlobalRegistry, backendFromEnv } = require('../src/registry');

const HASH = crypto.createHash('sha256').update('caps').digest('hex');
const entry = (ntId) => ({ ntId, capsHash: HASH, region: 'eu-west', groupId: 'acme', policy: { cpuCapPct: 5, acceptRemote: false } });

test('registre : inscription, heartbeat, expiration, purge', () => {
  const r = new GlobalRegistry({ ttlMs: 1000 });
  r.register(entry('a'.repeat(64)), 1000);
  assert.equal(r.listLive({ now: 1500 }).length, 1);
  assert.equal(r.listLive({ now: 2500 }).length, 0, 'expiré toujours vivant');
  r.heartbeat('a'.repeat(64), 2400);
  assert.equal(r.listLive({ now: 2500 }).length, 1);
  assert.equal(r.sweep(4000), 1);
  assert.throws(() => r.heartbeat('b'.repeat(64), 1), /inconnu/);
});

test('registre : aucune IP acceptée, filtres région/groupe', () => {
  const r = new GlobalRegistry({});
  assert.throws(() => r.register({ ...entry('c'.repeat(64)), ip: '192.168.1.5' }), /adresse interdit/);
  assert.throws(() => r.register({ ntId: 'court', capsHash: HASH, region: 'x' }), /ntId/);
  r.register(entry('d'.repeat(64)), 0);
  assert.equal(r.listLive({ now: 0, region: 'eu-west', groupId: 'acme' }).length, 1);
  assert.equal(r.listLive({ now: 0, region: 'us' }).length, 0);
  const live = r.listLive({ now: 0 });
  assert.ok(!JSON.stringify(live).includes('192.168'), 'IP privée publiée');
});

test('registre : persistance fichier et backend par environnement', () => {
  const dir = path.join(__dirname, '.tmp-reg');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'registry.json');
  const r1 = new GlobalRegistry({ file });
  r1.register(entry('e'.repeat(64)), 100);
  const r2 = new GlobalRegistry({ file });
  assert.equal(r2.listLive({ now: 200 }).length, 1, 'persistance non relue');
  assert.equal(backendFromEnv({}).mode, 'fichier-local');
  assert.equal(backendFromEnv({ SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'k' }).configured, true);
});

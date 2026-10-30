'use strict';

/**
 * Non-régression P0 (audit 2026-10-29) : STOP pendant une charge CPU
 * active — aucun worker survivant, aucune exécution post-arrêt.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Sandbox } = require('../src/sandbox');

test('P0 : shutdown pendant charge CPU — threads tués, run suivant refusé', async () => {
  const sb = new Sandbox({ maxWorkers: 1, execTimeoutMs: 60000 });
  const pending = [];
  let pumping = true;
  const pump = () => {
    while (pumping) {
      try {
        const p = sb.run('primes', { max: 200000 });
        p.catch(() => {});
        pending.push(p);
      } catch { break; }
      if (pending.length > 500) break;
    }
  };
  // Attendre un instant où le worker est réellement en vol (charge continue).
  const t0 = Date.now();
  while (sb.stats().active !== 1 && Date.now() - t0 < 10000) {
    pump();
    await new Promise((r) => setTimeout(r, 2));
  }
  pumping = false;
  assert.equal(sb.stats().active, 1, 'le worker doit être en vol sous charge');
  const res = await sb.shutdown();
  assert.equal(res.stopped, true);
  assert.equal(res.killed, 1, 'le worker en vol doit être tué');
  assert.equal(sb.stats().active, 0, 'plus aucun actif après shutdown');
  const outcomes = await Promise.allSettled(pending);
  assert.ok(outcomes.every((o) => o.status === 'rejected'), 'toute tâche doit être rejetée');
  assert.ok(
    outcomes.some((o) => /sandbox-shutdown/.test(o.reason && o.reason.message || '')),
    'au moins la tâche en vol est annulée par shutdown'
  );
  // Aucune nouvelle exécution après arrêt : refus, pas de thread créé.
  await assert.rejects(sb.run('fib', { n: 10 }), /sandbox-shutdown/);
});

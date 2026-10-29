'use strict';

/**
 * Tests [MATÉRIEL] Windows natif : télémétrie réelle et effet mesuré du
 * découpage temporel. Aucune valeur injectée ici.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { systemTelemetry } = require('../src/telemetry');

test('[MATÉRIEL] télémétrie système réelle, indisponibles marqués', () => {
  const t = systemTelemetry();
  assert.equal(t.source, 'system');
  assert.ok(t.cpus >= 1 && Number.isInteger(t.cpus));
  assert.ok(t.totalMem > 0 && t.freeMem >= 0);
  assert.ok(t.procRss > 0);
  // Honnêteté : ce qui n'est pas mesurable est marqué, pas inventé.
  assert.equal(t.battery.available, false);
  assert.equal(t.thermal.available, false);
  assert.equal(t.loadavg.available, false);
});

test('[MATÉRIEL] découpage temporel 10 % : CPU mesuré très sous 100 %', async () => {
  // Boucle CPU-bound 2 s avec service 100 ms / pause 900 ms (duty 10 %).
  const start = process.cpuUsage();
  const t0 = Date.now();
  let x = 0;
  while (Date.now() - t0 < 2000) {
    const w0 = Date.now();
    while (Date.now() - w0 < 100) {
      x += Math.sqrt(x + 1); // charge CPU réelle
    }
    await new Promise((r) => setTimeout(r, 900));
  }
  const end = process.cpuUsage(start);
  const usedMs = (end.user + end.system) / 1000;
  const ratio = usedMs / 2000;
  console.log(`    CPU mesuré sur 2 s à duty 10 % : ${(ratio * 100).toFixed(1)} % (x=${Math.round(x) % 1000})`);
  assert.ok(ratio < 0.35, `duty inefficace : ${ratio}`);
  assert.ok(usedMs > 50, 'charge trop faible pour être crédible');
});

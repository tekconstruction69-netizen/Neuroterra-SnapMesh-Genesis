'use strict';

/**
 * Démo : tâche CPU réelle transmise sur le transport Direct, avec mesures
 * (latence aller-retour, octets) puis coupure simulée du lien et reprise.
 * Portée : MÊME HÔTE, transport en mémoire (étiqueté) — prouve le chemin
 * logique (trames, remise, reprise) et l'exécution sandbox réelle, PAS
 * une radio. Protections conservées : sandbox bornée, STOP prioritaire.
 * Usage : node scripts/demo-direct-task.js [--out bench-logs/...json]
 */

const fs = require('node:fs');
const { LoopbackDirect, makeFrame, transit } = require('../mesh-net/src/direct');
const { Sandbox } = require('../mesh-compute/src/sandbox');

async function main() {
  const bus = new LoopbackDirect();
  bus.attach('A');
  bus.attach('B');
  const sb = new Sandbox({ maxWorkers: 1, execTimeoutMs: 10000 });
  // A → B : demande de tâche CPU réelle (crible borné).
  const t0 = process.hrtime.bigint();
  const req = makeFrame({ from: 'A', to: 'B', sealed: JSON.stringify({ op: 'primes', args: { max: 200000 } }) });
  bus.send('B', req);
  const [got] = bus.drain('B');
  const dec = transit(got, 'B');
  if (dec.action !== 'deliver') throw new Error('non remis');
  const task = JSON.parse(dec.frame.sealed);
  const out = await sb.run(task.op, task.args);
  const res = makeFrame({ from: 'B', to: 'A', sealed: JSON.stringify({ result: out.result }) });
  bus.send('A', res);
  const [back] = bus.drain('A');
  const rttMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const bytes = Buffer.byteLength(req.sealed) + Buffer.byteLength(res.sealed);
  // Coupure simulée du lien : envoi vers inconnu, puis reprise.
  let coupure = null;
  try { bus.send('C', makeFrame({ from: 'A', to: 'C', sealed: 'x' })); } catch (e) { coupure = e.message; }
  const retry = makeFrame({ from: 'A', to: 'B', sealed: JSON.stringify({ op: 'fib', args: { n: 20 } }) });
  bus.send('B', retry);
  const [got2] = bus.drain('B');
  const out2 = await sb.run(JSON.parse(transit(got2, 'B').frame.sealed).op, { n: 20 });
  await sb.shutdown();
  const report = {
    module: 'direct-task', portee: 'MEME HOTE, transport memoire (pas de radio)',
    resultatTache: out2.result, latenceAllerRetourMs: +rttMs.toFixed(3),
    octetsTransportes: bytes, coupureSimulee: coupure, repriseApresCoupure: out2.result !== undefined,
  };
  console.log(JSON.stringify(report, null, 2));
  const i = process.argv.indexOf('--out');
  if (i !== -1) fs.writeFileSync(process.argv[i + 1], JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error('demo-direct-task:', e.message); process.exit(1); });

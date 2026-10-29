#!/usr/bin/env node
'use strict';

/**
 * Benchmarks B0/B1/B2 (+ capacity/muse mêmes conditions) — §10.
 * Protocole fixe : même charge (fib × N, redondance 1), mêmes nœuds
 * loopback, R répétitions, pairs manuels (zéro variance découverte).
 * Métriques : complétion, makespans mesurés (moyenne + écart-type + N).
 * Journal brut JSONL horodaté. AUCUNE conclusion de supériorité : les
 * chiffres sont rapportés, pas interprétés (même hôte, O5 hypothèse).
 *
 *   node scripts/bench-b0b1b2.js [--reps 5] [--tasks 4]
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'mesh-compute', 'bin', 'compute-node.js');
const argsOf = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
};
const REPS = Math.max(1, Number(argsOf('reps', '5')));
const TASKS = Math.max(1, Number(argsOf('tasks', '4')));
const EXPECTED = 75025; // F(25)

const EXEC = 48390;
const COORD0 = 48391;
const children = [];
process.on('exit', () => {
  for (const c of children) {
    try {
      c.kill('SIGKILL');
    } catch {}
  }
});

function launch(name, tcpPort, extraArgs) {
  const child = spawn(process.execPath, [BIN, '--name', name, '--port', String(tcpPort), '--status-port', String(tcpPort + 500), '--quiet', ...extraArgs], {
    cwd: path.join(ROOT, 'mesh-compute', 'test', '.tmp-int'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.taskLines = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const m = line.match(/^\[task\] (.*)$/);
      if (m) {
        try {
          child.taskLines.push(JSON.parse(m[1]));
        } catch {}
      }
    }
  });
  return child;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function oneRep(config, rep, coordPort) {
  const solo = config.peers === 0;
  const coord = launch(`bench-${config.name}-r${rep}`, coordPort, [
    ...(solo ? [] : ['--peers', `127.0.0.1:${EXEC}`]),
    '--no-discovery',
    '--scheduler', config.scheduler,
    '--submit', 'fib', '--args', '{"n":25}', '--redundancy', '1',
    '--submit-count', String(TASKS),
    '--submit-delay-ms', '4000',
    '--submit-wait-peers', solo ? '0' : '1',
  ]);
  const t0 = Date.now();
  for (;;) {
    if (coord.taskLines.length >= TASKS) break;
    if (Date.now() - t0 > 90000) throw new Error(`timeout rep ${config.name}#${rep}`);
    await sleep(250);
  }
  const wallMs = Date.now() - t0;
  coord.kill('SIGKILL');
  return { tasks: coord.taskLines, wallMs };
}

function stats(xs) {
  const n = xs.length;
  const mean = xs.reduce((t, v) => t + v, 0) / Math.max(1, n);
  const sd = Math.sqrt(xs.reduce((t, v) => t + (v - mean) ** 2, 0) / Math.max(1, n));
  return { n, mean, sd };
}

async function main() {
  fs.mkdirSync(path.join(ROOT, 'mesh-compute', 'test', '.tmp-int'), { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(ROOT, 'bench-logs', `bench-b0b1b2-${ts}.log`);
  const log = (o) => fs.appendFileSync(logPath, `${JSON.stringify(o)}\n`);
  const header = {
    kind: 'bench-header', at: new Date().toISOString(),
    platform: os.platform(), arch: os.arch(), cpus: os.cpus().length,
    totalMem: os.totalmem(), node: process.version,
    load: { op: 'fib', args: { n: 25 }, tasksPerRep: TASKS, reps: REPS, redundancy: 1 },
    scope: 'même hôte loopback (pas de conclusion multi-appareils)',
  };
  log(header);
  // Exécutant partagé (sauf B0 solo) : démarré une fois, maillage stable.
  launch('bench-exec', EXEC, ['--no-discovery']);
  await sleep(1500);
  const configs = [
    { name: 'B0-local-solo', scheduler: 'local', peers: 0 },
    { name: 'B1-round-robin', scheduler: 'round-robin', peers: 1 },
    { name: 'B2-local-2noeuds', scheduler: 'local', peers: 1 },
    { name: 'capacity-2noeuds', scheduler: 'capacity', peers: 1 },
    { name: 'muse-2noeuds', scheduler: 'muse', peers: 1 },
  ];
  const table = [];
  let port = COORD0;
  for (const cfg of configs) {
    const makes = [];
    const walls = [];
    let done = 0;
    let total = 0;
    for (let r = 0; r < REPS; r++) {
      const { tasks, wallMs } = await oneRep(cfg, r, port++);
      walls.push(wallMs);
      for (const t of tasks) {
        total++;
        const ok = t.outcome === 'done' && t.value === EXPECTED;
        if (ok) {
          done++;
          makes.push(t.makespanMs);
        }
        log({ kind: 'task', config: cfg.name, rep: r, outcome: t.outcome, value: t.value, makespanMs: t.makespanMs, attempts: t.attempts, scheduler: t.scheduler });
      }
      log({ kind: 'rep', config: cfg.name, rep: r, wallMs });
    }
    table.push({ config: cfg.name, completion: `${done}/${total}`, makespan: stats(makes), wall: stats(walls) });
  }
  for (const row of table) {
    log({ kind: 'config-summary', ...row });
    console.log(`${row.config} : complétion ${row.completion} ; makespan tâche N=${row.makespan.n} moy=${row.makespan.mean.toFixed(1)}ms σ=${row.makespan.sd.toFixed(1)} ; mur/rep N=${row.wall.n} moy=${row.wall.mean.toFixed(0)}ms σ=${row.wall.sd.toFixed(0)}`);
  }
  console.log(`Journal brut : ${logPath}`);
}

main().then(() => process.exit(0), (e) => {
  console.error(`ÉCHEC BENCH : ${e.message}`);
  process.exit(1);
});

'use strict';

/**
 * Correctifs démarrage/analyse : états dérivés, solo sans panne,
 * perte réelle puis reconnexion, STOP répétés, sonde système étiquetée.
 * Télémétrie injectée = [SIMULÉ] ; sonde réelle lue séparément.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SafetyController } = require('../src/controller');
const { injectTelemetry, systemTelemetry } = require('../src/telemetry');
const { probeSystem } = require('../src/sysinfo');

const tel = (over = {}) => injectTelemetry({ memRatio: 0.4, ...over });

test('solo : START sans pair = WAITING_FOR_PEERS, jamais SUSPENDED', () => {
  const c = new SafetyController({});
  const s = c.start({ consent: true }, tel());
  assert.equal(s.state, 'ACTIVE');
  assert.equal(c.deriveWorkerState({ peers: 0, everHadPeers: false }), 'WAITING_FOR_PEERS');
  assert.equal(c.deriveWorkerState({ peers: 2, everHadPeers: true }), 'WAITING_FOR_TASKS');
  const sig = c.track('t1', 'calcul local');
  assert.equal(c.deriveWorkerState({ peers: 0 }), 'RUNNING');
  c.untrack('t1');
  assert.equal(sig.aborted, false);
});

test('perte réelle après pair vu : CONNECTION_LOST puis reprise', () => {
  const c = new SafetyController({});
  c.start({ consent: true }, tel());
  c.onMeshBack(); // pair vu au moins une fois (chemin serveur hadPeers)
  c.onMeshLost();
  assert.equal(c.status().state, 'SUSPENDED');
  assert.equal(c.deriveWorkerState({ peers: 0, everHadPeers: true }), 'CONNECTION_LOST');
  c.onMeshBack();
  assert.equal(c.status().state, 'ACTIVE');
  assert.equal(c.deriveWorkerState({ peers: 1, everHadPeers: true }), 'WAITING_FOR_TASKS');
});

test('STOP pendant tâche, START/STOP répétés, pause protection distincte', async () => {
  const c = new SafetyController({});
  for (let i = 0; i < 3; i++) {
    c.start({ consent: true }, tel());
    const sig = c.track(`t${i}`);
    const r = await c.stop('test répété');
    assert.equal(r.stopped, true);
    assert.equal(sig.aborted, true, 'STOP n\u2019a pas annulé la tâche');
    assert.equal(c.status().state, 'STOPPED');
    assert.equal(c.deriveWorkerState({}), 'STOPPED');
  }
  const c2 = new SafetyController({});
  c2.start({ consent: true }, tel());
  c2.tick(tel({ battery: { available: true, low: true, charging: false } }));
  assert.equal(c2.deriveWorkerState({}), 'PAUSED_SAFETY');
});

test('sonde système : étiquettes honnêtes, échec CIM = non disponible', () => {
  const okRunner = (cmd, args) => {
    const script = args[args.length - 1];
    if (/Win32_Processor/.test(script)) return JSON.stringify({ NumberOfCores: 8, NumberOfLogicalProcessors: 16, Name: 'CPU-Test' });
    if (/Win32_VideoController/.test(script)) return JSON.stringify({ Name: 'GPU-Test', AdapterRAM: 8 * 2 ** 30 });
    if (/Win32_Battery/.test(script)) return JSON.stringify({ EstimatedChargeRemaining: 87, BatteryStatus: 2 });
    throw new Error('inconnu');
  };
  const info = probeSystem({ runner: okRunner });
  assert.equal(info.cpuPhysiques.valeur, 8);
  assert.equal(info.gpuModele.valeur, 'GPU-Test');
  assert.equal(info.batterie.valeur.pct, 87);
  assert.equal(info.thermique.statut, 'non disponible');
  const ko = probeSystem({ runner: () => { throw new Error('CIM refusé'); } });
  assert.equal(ko.cpuPhysiques.statut, 'non disponible');
  assert.equal(ko.gpuModele.statut, 'non disponible');
  assert.ok(ko.cpuLogiques.valeur >= 1, 'cœurs logiques Node perdus');
});

test('Wi-Fi Direct : pilote sondé en lecture seule, jamais activé', () => {
  const runner = (cmd, args) => {
    if (cmd === 'netsh.exe') return 'Interface name : Wi-Fi\nWi-Fi Direct Device : Available\n';
    const script = args[args.length - 1];
    if (/Win32_Processor/.test(script)) return JSON.stringify({ NumberOfCores: 4, NumberOfLogicalProcessors: 8, Name: 'CPU' });
    throw new Error('refusé');
  };
  const info = probeSystem({ runner });
  assert.equal(info.wifiAdapter.valeur, 'Wi-Fi');
  assert.equal(info.wifiDirect.statut, 'détecté');
  const runnerNo = (cmd) => {
    if (cmd === 'netsh.exe') return 'Interface name : Wi-Fi\n';
    throw new Error('refusé');
  };
  assert.equal(probeSystem({ runner: runnerNo }).wifiDirect.statut, 'non disponible');
});

test('P0 : setTargets refuse tout invalide, accepte le valide borné', () => {
  const { SafetyController } = require('../src/controller');
  const c = new SafetyController({});
  const bad = [
    { cpuTarget: NaN }, { cpuTarget: Infinity }, { cpuTarget: 0 }, { cpuTarget: 0.51 },
    { cpuTarget: '0.05' }, { cpuTarget: null }, { cpuTarget: undefined },
    { workers: 0 }, { workers: -1 }, { workers: 1.5 }, { workers: NaN },
    { workers: Infinity }, { workers: '2' }, { workers: null }, { workers: 65 },
    { concurrent: 0 }, { concurrent: 'x' }, { concurrent: null },
    { inconnu: 1 }, null, 'x', [],
  ];
  for (const v of bad) {
    assert.throws(() => c.setTargets(v), /cible|cibles/, `accepté à tort : ${JSON.stringify(v)}`);
  }
  c.setTargets({ cpuTarget: 0.05, workers: 2, concurrent: 2 });
  assert.equal(c.targets.workers, 2);
  c.setTargets({}); // partiel vide : conserve sans écraser
  assert.equal(c.targets.cpuTarget, 0.05);
});

test('télémétrie réelle de ce poste : thermique marquée indisponible', () => {
  const t = systemTelemetry();
  assert.equal(t.thermal.available, false);
  assert.ok(t.cpus >= 1 && t.totalMem > 0);
});

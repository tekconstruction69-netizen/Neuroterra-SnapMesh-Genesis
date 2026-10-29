'use strict';

/** Tests unitaires safety. Télémétrie injectée = [SIMULÉ], sauf mention. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SafetyController } = require('../src/controller');
const { ThermalMachine } = require('../src/thermal');
const { injectTelemetry } = require('../src/telemetry');
const { MATRIX } = require('../src/platforms');

function okTel(over = {}) {
  return injectTelemetry({ memRatio: 0.4, ...over });
}

test('[SIMULÉ] START exige un consentement explicite', () => {
  const c = new SafetyController({});
  const s = c.start({}, okTel());
  assert.equal(s.state, 'ERROR');
  assert.match(s.reason, /consentement/);
});

test('[SIMULÉ] START refuse batterie faible et mémoire saturée', () => {
  const c = new SafetyController({});
  let s = c.start({ consent: true }, okTel({ battery: { available: true, low: true, charging: false } }));
  assert.equal(s.state, 'ERROR');
  const c2 = new SafetyController({});
  s = c2.start({ consent: true }, okTel({ memRatio: 0.95 }));
  assert.equal(s.state, 'ERROR');
});

test('[SIMULÉ] START ok puis STOP prioritaire : tâche annulée et confirmée', async () => {
  const c = new SafetyController({});
  c.start({ consent: true }, okTel());
  assert.equal(c.state, 'ACTIVE');
  const sig = c.track('t1', 'fib');
  assert.equal(sig.aborted, false);
  sig.addEventListener('abort', () => c.untrack('t1')); // le propriétaire libère sur abort
  const res = await c.stop('test');
  assert.equal(res.stopped, true);
  assert.equal(c.state, 'STOPPED');
  assert.equal(sig.aborted, true);
  assert.equal(res.confirmed, true);
});

test('[SIMULÉ] ordonnanceur refusé quand STOPPED (pas de contournement)', () => {
  const c = new SafetyController({});
  const r = c.requestBudget({ tasks: 1 }, okTel());
  assert.equal(r.granted, false);
  assert.match(r.reason, /STOPPED/);
});

test('[SIMULÉ] concurrence maximale appliquée', () => {
  const c = new SafetyController({ mode: 'eco' }); // concurrent: 1
  c.start({ consent: true }, okTel());
  c.track('a');
  const r = c.requestBudget({ tasks: 1 }, okTel());
  assert.equal(r.granted, false);
  assert.match(r.reason, /concurrence/);
});

test('[SIMULÉ] thermique : THROTTLED puis urgence verrouillée + reset', () => {
  const m = new ThermalMachine('laptop-windows');
  assert.equal(m.evaluate(okTel({ thermal: { available: true, celsius: 76 } })), 'THROTTLED');
  assert.equal(m.evaluate(okTel({ thermal: { available: true, celsius: 91 } })), 'EMERGENCY_STOP');
  const c = new SafetyController({ deviceClass: 'laptop-windows' });
  c.start({ consent: true }, okTel());
  c.track('x');
  c.tick(okTel({ thermal: { available: true, celsius: 91 } }));
  assert.equal(c.state, 'ERROR');
  assert.equal(c.tasks.size, 0, 'ressources libérées');
  assert.equal(c.resetEmergency(okTel({ thermal: { available: true, celsius: 91 } })), false, 'reset refusé à chaud');
  assert.equal(c.resetEmergency(okTel({ thermal: { available: true, celsius: 60 } })), true);
  assert.equal(c.state, 'STOPPED', 'START requis après reset');
});

test('télémétrie absente : jamais de température inventée, état stable', () => {
  const m = new ThermalMachine('desktop-windows');
  assert.equal(m.evaluate(okTel({ memRatio: 0.4 })), 'NORMAL');
  assert.equal(m.evaluate(okTel({ memRatio: 0.87 })), 'THROTTLED', 'proxy mémoire, pas température');
  assert.equal(m.evaluate(okTel({ memRatio: 0.93 })), 'PAUSED');
});

test('[SIMULÉ] batterie faible en cours + mémoire saturée suspendent', () => {
  const c = new SafetyController({});
  c.start({ consent: true }, okTel());
  c.tick(okTel({ battery: { available: true, low: true, charging: false } }));
  assert.equal(c.state, 'SUSPENDED');
  const c2 = new SafetyController({});
  c2.start({ consent: true }, okTel());
  c2.tick(okTel({ memRatio: 0.95 }));
  assert.equal(c2.state, 'SUSPENDED');
});

test('[SIMULÉ] déconnexion réseau : SUSPENDED avec reprise, STOP prioritaire', () => {
  const c = new SafetyController({});
  c.start({ consent: true }, okTel());
  const sig = c.track('t9');
  sig.addEventListener('abort', () => c.untrack('t9')); // propriétaire câblé comme l'app
  c.onMeshLost();
  assert.equal(c.state, 'SUSPENDED');
  assert.match(c.stateReason, /réseau/);
  assert.equal(c.tasks.size, 0, 'tâches délestées');
  assert.equal(c.requestBudget({ tasks: 1 }, okTel()).granted, false, 'budgets fermés');
  c.onMeshBack();
  assert.equal(c.state, 'ACTIVE', 'reprise auto après retour réseau');
  assert.equal(c.meshSuspended, false);
});

test('[SIMULÉ] réseau : STOP manuel et urgence jamais réanimés par le retour', async () => {
  const c = new SafetyController({});
  c.start({ consent: true }, okTel());
  c.onMeshLost();
  await c.stop('manuel');
  c.onMeshBack();
  assert.equal(c.state, 'STOPPED', 'STOP reste STOP');
  const c2 = new SafetyController({});
  c2.start({ consent: true }, okTel());
  c2.tick(okTel({ thermal: { available: true, celsius: 99 } }));
  assert.equal(c2.state, 'ERROR');
  c2.onMeshLost();
  c2.onMeshBack();
  assert.equal(c2.state, 'ERROR', 'urgence non levée par le réseau');
});

test('[SIMULÉ] réseau présent : aucun effet', () => {
  const c = new SafetyController({});
  c.start({ consent: true }, okTel());
  c.onMeshBack();
  assert.equal(c.state, 'ACTIVE');
  const s = new SafetyController({});
  s.onMeshLost();
  assert.equal(s.state, 'STOPPED', 'STOPPED insensible');
});

test('cibles configurables 1/5/10 %, bornes rejetées', () => {
  const c = new SafetyController({ mode: 'eco' });
  assert.equal(c.targets.cpuTarget, 0.01);
  c.setTargets({ cpuTarget: 0.05 });
  assert.equal(c.targets.cpuTarget, 0.05);
  assert.throws(() => c.setTargets({ cpuTarget: 0.9 }), /cible-cpu-invalide/);
  assert.throws(() => new SafetyController({ mode: 'turbo' }), /mode-inconnu/);
});

test('matrice plateformes : pas de promesse arrière-plan/thermique web', () => {
  assert.match(MATRIX['web-pwa'].workersBg, /non/);
  assert.match(MATRIX['web-pwa'].thermal, /non exposée/);
  assert.match(MATRIX['android-native'].status, /PRÉVU/);
  assert.match(MATRIX['ios-native'].status, /PRÉVU/);
});

'use strict';

/**
 * Télémétrie : mesures RÉELLES quand l'OS les expose, marquées
 * `available:false` + motif sinon. On n'invente JAMAIS une valeur :
 * batterie/thermique/loadavg sont indisponibles sur ce Windows vu du
 * sandbox (accès WMI refusé) et loadavg vaut toujours [0,0,0] sur Windows.
 * Les tests utilisent injectTelemetry() et restent étiquetés [SIMULÉ].
 */

const os = require('node:os');

function systemTelemetry() {
  const cpus = os.cpus().length;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpu = process.cpuUsage();
  const mem = process.memoryUsage();
  return {
    source: 'system',
    at: Date.now(),
    platform: os.platform(),
    cpus,
    totalMem,
    freeMem,
    memRatio: 1 - freeMem / totalMem,
    procCpuMicros: cpu.user + cpu.system,
    procRss: mem.rss,
    procHeapUsed: mem.heapUsed,
    // Indisponibles ou inexploitables ici : marqués, pas inventés.
    loadavg: { available: false, reason: 'loadavg toujours [0,0,0] sur Windows' },
    battery: { available: false, reason: 'pas d API batterie en Node (WMI Win32_Battery refusé ici)' },
    thermal: { available: false, reason: 'pas de télémétrie thermique fiable (WMI refusé ici)' },
  };
}

/** Télémétrie injectée pour tests et politique conservatrice. Étiquetée simulée. */
function injectTelemetry(over = {}) {
  return {
    source: 'simulated',
    at: Date.now(),
    platform: over.platform || 'win32',
    cpus: over.cpus ?? 4,
    totalMem: over.totalMem ?? 8 * 2 ** 30,
    freeMem: over.freeMem ?? 4 * 2 ** 30,
    memRatio: over.memRatio ?? 0.5,
    procCpuMicros: over.procCpuMicros ?? 0,
    procRss: over.procRss ?? 100 * 2 ** 20,
    procHeapUsed: over.procHeapUsed ?? 50 * 2 ** 20,
    loadavg: { available: false, reason: 'injectée' },
    battery: over.battery || { available: false, reason: 'injectée absente' },
    thermal: over.thermal || { available: false, reason: 'injectée absente' },
  };
}

module.exports = { systemTelemetry, injectTelemetry };

'use strict';

/**
 * NT-COMPAT — registre de capacités versionné + validateur d'affectation.
 * Construit depuis le profil NT-CAP signé (mesh-net) + backends détectés
 * (backends.js) + budgets safety. Le validateur empêche toute affectation
 * incompatible avec un motif explicite (jamais d'exception muette).
 */

const { detectBackends } = require('./backends');

const COMPAT_V = 1;

/** Octets par élément et par dtype. */
const DTYPE_BYTES = { fp64: 8, fp32: 4, fp16: 2, int8: 1 };

/**
 * Construit le registre local : { v, at, capsProfil, backends, mem }.
 * - capsProfil : profil NT-CAP (optionnel, joint pour traçabilité).
 * - mem : RAM mesurée + plafond configurable (défaut : moitié de la RAM
 *   libre — conservateur, jamais de promesse de disponibilité totale).
 */
function buildRegistry({ capsProfil = null, backendScan = null, memCapBytes = null, detectOpts = {} } = {}) {
  const os = require('node:os');
  const scan = backendScan || detectBackends(detectOpts);
  const free = os.freemem();
  return {
    v: COMPAT_V,
    at: new Date().toISOString(),
    capsProfil,
    backends: scan.backends,
    arch: scan.arch,
    threads: scan.threads,
    mem: {
      totalBytes: os.totalmem(),
      freeBytes: free,
      capBytes: memCapBytes !== null ? memCapBytes : Math.floor(free / 2),
    },
  };
}

function isObj(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o);
}

/**
 * Tâche typée : { id, op, dtype, backend?, tensors:[{shape:[...]}],
 *   memExtraBytes?, minThreads? }.
 * Retourne { ok:true, backend, estBytes } ou { ok:false, reason }.
 * Règles : backend exigé présent ; dtype supporté ; mémoire estimée
 * (tenseurs + marge) sous plafond ; threads suffisants.
 */
function checkAssignment(registry, task) {
  const no = (reason) => ({ ok: false, reason });
  if (!isObj(registry) || registry.v !== COMPAT_V) return no('registre invalide (v attendue 1)');
  if (!isObj(task) || typeof task.id !== 'string' || !task.id) return no('tâche sans id');
  if (!Array.isArray(task.tensors) || !task.tensors.length) return no(`tâche ${task.id} : tenseurs requis`);
  const per = DTYPE_BYTES[task.dtype];
  if (!per) return no(`tâche ${task.id} : dtype inconnu ${task.dtype}`);
  const avail = Object.entries(registry.backends || {})
    .filter(([, b]) => b && b.available && Array.isArray(b.dtypes) && b.dtypes.includes(task.dtype))
    .map(([name]) => name);
  if (!avail.length) return no(`tâche ${task.id} : aucun backend pour ${task.dtype}`);
  let backend = task.backend || null;
  if (backend) {
    const b = (registry.backends || {})[backend];
    if (!b || !b.available) return no(`tâche ${task.id} : backend ${backend} indisponible (${(b && b.reason) || 'inconnu'})`);
    if (!b.dtypes.includes(task.dtype)) return no(`tâche ${task.id} : ${backend} ne supporte pas ${task.dtype}`);
  } else {
    backend = avail[0]; // déterministe : premier compatible (ordre de détection)
  }
  let elems = 0;
  for (const t of task.tensors) {
    if (!isObj(t) || !Array.isArray(t.shape) || !t.shape.length) return no(`tâche ${task.id} : tenseur sans shape`);
    let n = 1;
    for (const d of t.shape) {
      if (!Number.isInteger(d) || d < 1 || d > 4096) return no(`tâche ${task.id} : dimension invalide ${d} (1..4096)`);
      n *= d;
    }
    elems += n;
  }
  const estBytes = elems * per + (Number.isInteger(task.memExtraBytes) ? task.memExtraBytes : 0);
  if (estBytes > registry.mem.capBytes) {
    return no(`tâche ${task.id} : ~${estBytes} o > plafond ${registry.mem.capBytes} o`);
  }
  if (Number.isInteger(task.minThreads) && task.minThreads > registry.threads) {
    return no(`tâche ${task.id} : ${task.minThreads} threads exigés, ${registry.threads} détectés`);
  }
  return { ok: true, backend, estBytes };
}

module.exports = { COMPAT_V, DTYPE_BYTES, buildRegistry, checkAssignment };

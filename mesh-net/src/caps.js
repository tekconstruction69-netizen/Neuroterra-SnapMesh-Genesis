'use strict';

/**
 * NT-CAP : profil de capacités versionné et signé.
 * Règle : jamais de capacité inventée — GPU/NPU/batterie/thermique sont
 * marqués indisponibles avec motif quand l'OS ne les expose pas.
 * Le profil voyage dans HELLO (authentifié par l'enveloppe + signature
 * propre vérifiable hors-ligne, ex. futur annuaire DHT).
 */

const os = require('node:os');
const fs = require('node:fs');
const { Identity } = require('./identity');

const CAPS_V = 2;

function stable(o) {
  return JSON.stringify(o);
}

function buildCaps({ limits = null, battery = null, thermal = null } = {}) {
  let storageFree = null;
  let storageReason = 'non mesuré';
  try {
    const st = fs.statfsSync(process.cwd());
    if (st && typeof st.bavail === 'number') {
      storageFree = st.bavail * (st.bsize || 4096);
      storageReason = null;
    }
  } catch {
    storageReason = 'statfs indisponible';
  }
  return {
    v: CAPS_V,
    cpu: {
      arch: os.arch(),
      threads: os.cpus().length,
      model: (os.cpus()[0] && os.cpus()[0].model) || 'unknown',
      budget: limits && typeof limits.cpuTarget === 'number' ? limits.cpuTarget : null,
    },
    gpu: { available: false, reason: 'pas de détection GPU en Node pur' },
    npu: { available: false, reason: 'pas de détection NPU en Node pur' },
    ram: { total: os.totalmem(), free: os.freemem() },
    storage: storageFree === null
      ? { available: false, reason: storageReason }
      : { available: true, free: storageFree },
    net: { transports: ['tcp-ip'], rttMs: null }, // rttMs renseigné par les heartbeats
    battery: battery && battery.available
      ? { available: true, low: !!battery.low, charging: !!battery.charging }
      : { available: false, reason: (battery && battery.reason) || 'non mesurée' },
    thermal: thermal && thermal.available
      ? { available: true, celsius: thermal.celsius }
      : { available: false, reason: (thermal && thermal.reason) || 'non mesurée' },
    limits: limits || null, // budgets explicitement autorisés par l'utilisateur
    updatedAt: Date.now(),
  };
}

/** Signe le profil (hors champ sig) avec la clé du nœud. */
function signCaps(identity, caps) {
  const { sig, ...rest } = caps;
  void sig;
  const s = identity.sign(Buffer.from(stable(rest)));
  return { ...rest, sig: s.toString('base64') };
}

/** Vérifie un profil signé avec la clé publique SPKI DER (base64). */
function verifyCaps(caps, pubB64) {
  try {
    if (!caps || typeof caps !== 'object' || typeof caps.sig !== 'string') return false;
    const { sig, ...rest } = caps;
    const pub = Buffer.from(pubB64, 'base64');
    return Identity.verifyWith(pub, Buffer.from(stable(rest)), Buffer.from(sig, 'base64'));
  } catch {
    return false;
  }
}

module.exports = { CAPS_V, buildCaps, signCaps, verifyCaps };

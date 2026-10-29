'use strict';

/**
 * NT-PQ — signatures ML-DSA-65 (node:crypto) pour identités et reçus
 * compatibles §7, anti-rejeu par nonce, rotation/révocation.
 * Format reçu PQ : même contenu canonique que receipts.js + champ
 * alg:'ml-dsa-65' (interop : l'arbitre route selon alg).
 */

const crypto = require('node:crypto');

const DSA_ALG = 'ml-dsa-65';

function genSigningIdentity() {
  return crypto.generateKeyPairSync(DSA_ALG);
}

function spkiDer(pubKey) {
  return pubKey.export({ format: 'der', type: 'spki' });
}

/** Octets canoniques signés (même tableau que receipts.js + alg). */
function pqReceiptBytes(r) {
  return Buffer.from(JSON.stringify(['pq', r.v, r.taskId, r.op, r.executor, r.inHash, r.outHash, r.durationMs, r.nonce]), 'utf8');
}

/**
 * Reçu PQ : {v, taskId, op, executor, inHash, outHash, durationMs, nonce}.
 * nonce = 16 o aléatoires (anti-rejeu : refusé si déjà vu).
 */
function makePqReceipt(privKey, { taskId, op, inHash, outHash, executor, durationMs }) {
  const receipt = {
    v: 1, taskId, op, executor, inHash, outHash, durationMs,
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const sig = crypto.sign(null, pqReceiptBytes(receipt), privKey).toString('base64');
  return { receipt, sig };
}

function verifyPqReceipt(receipt, sigB64, pubKey) {
  try {
    if (!receipt || typeof receipt !== 'object' || receipt.v !== 1) return false;
    for (const k of ['taskId', 'op', 'executor', 'inHash', 'outHash', 'durationMs', 'nonce']) {
      if (receipt[k] === undefined) return false;
    }
    if (typeof sigB64 !== 'string') return false;
    return crypto.verify(null, pqReceiptBytes(receipt), pubKey, Buffer.from(sigB64, 'base64'));
  } catch {
    return false;
  }
}

/** Cache anti-rejeu : nonce déjà vu (et non expiré) ⇒ rejet. */
class NonceCache {
  constructor({ max = 1000, ttlMs = 300000 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.seen = new Map(); // nonce -> expiry
  }
  check(nonce) {
    const now = Date.now();
    const exp = this.seen.get(nonce);
    if (exp && exp > now) return false; // rejoué
    // Purge paresseuse.
    if (this.seen.size >= this.max) {
      for (const [k, v] of this.seen) {
        if (v <= now) this.seen.delete(k);
        if (this.seen.size < this.max) break;
      }
      if (this.seen.size >= this.max) {
        const oldest = this.seen.keys().next().value;
        this.seen.delete(oldest);
      }
    }
    this.seen.set(nonce, now + this.ttlMs);
    return true;
  }
}

/**
 * Registre de clés : {id -> {alg, pubDer, revoked, rotatedTo}}.
 * revoke(id) : révocation immédiate ; rotate(id, newPub) : marque
 * l'ancienne révoquée et pointe vers la nouvelle (vérifiable).
 */
class KeyRegistry {
  constructor() {
    this.keys = new Map();
  }
  register(id, pubDer, alg = DSA_ALG) {
    if (this.keys.has(id)) throw new Error(`registre-pq: id dupliqué ${id}`);
    this.keys.set(id, { alg, pubDer: Buffer.from(pubDer), revoked: false, rotatedTo: null });
  }
  revoke(id) {
    const e = this.keys.get(id);
    if (!e) throw new Error(`registre-pq: id inconnu ${id}`);
    e.revoked = true;
  }
  rotate(id, newId, newPubDer, alg = DSA_ALG) {
    const e = this.keys.get(id);
    if (!e) throw new Error(`registre-pq: id inconnu ${id}`);
    if (e.revoked) throw new Error(`registre-pq: ${id} révoquée, rotation interdite`);
    this.register(newId, newPubDer, alg);
    e.revoked = true;
    e.rotatedTo = newId;
  }
  /** Clé utilisable (non révoquée) ou null. */
  usable(id) {
    const e = this.keys.get(id);
    if (!e || e.revoked) return null;
    return e;
  }
}

module.exports = { DSA_ALG, genSigningIdentity, spkiDer, makePqReceipt, verifyPqReceipt, pqReceiptBytes, NonceCache, KeyRegistry };

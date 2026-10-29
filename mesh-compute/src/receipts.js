'use strict';

/**
 * Reçus d'exécution §7 : lient une charge, un résultat et un exécutant.
 *
 * - `stableHash(obj)` : sha256 hex de `JSON.stringify(obj)`. L'ordre des
 *   clés est l'ordre d'insertion, identique des deux côtés pour des objets
 *   construits par le même chemin (soumission → enveloppe JSON → parse).
 *   Même version de nœuds exigée pour la comparaison inter-nœuds.
 * - Le reçu `{v, taskId, op, executor, inHash, outHash, durationMs}` est
 *   signé Ed25519 par l'exécutant ; la signature couvre les octets
 *   canoniques (tableau JSON, pas d'ambiguïté d'ordre).
 * - Portée honnête : le reçu prouve QUI a produit QUOI à partir de QUOI
 *   (imputabilité), PAS que le calcul est correct — l'exactitude vient du
 *   re-calcul local (r=1) et du quorum (`mesh-verify`). Voir docs/VERIFICATION.md.
 */

const crypto = require('node:crypto');

const RECEIPT_V = 1;

function stableHash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex');
}

/** Octets canoniques signés (tableau : ordre fixe, sans ambiguïté). */
function receiptBytes(r) {
  return Buffer.from(JSON.stringify([r.v, r.taskId, r.op, r.executor, r.inHash, r.outHash, r.durationMs]), 'utf8');
}

function makeReceipt(identity, { taskId, op, args, result, executor, durationMs }) {
  const receipt = {
    v: RECEIPT_V,
    taskId,
    op,
    executor,
    inHash: stableHash(args),
    outHash: stableHash(result),
    durationMs,
  };
  const sig = identity.sign(receiptBytes(receipt)).toString('base64');
  return { receipt, sig };
}

function verifyReceipt(receipt, sigB64, pubKey) {
  try {
    const { Identity } = require('../../mesh-net/src/identity');
    if (!receipt || typeof receipt !== 'object' || receipt.v !== RECEIPT_V) return false;
    for (const k of ['taskId', 'op', 'executor', 'inHash', 'outHash', 'durationMs']) {
      if (receipt[k] === undefined) return false;
    }
    if (typeof sigB64 !== 'string') return false;
    return Identity.verifyWith(pubKey, receiptBytes(receipt), Buffer.from(sigB64, 'base64'));
  } catch {
    return false;
  }
}

module.exports = { RECEIPT_V, stableHash, receiptBytes, makeReceipt, verifyReceipt };

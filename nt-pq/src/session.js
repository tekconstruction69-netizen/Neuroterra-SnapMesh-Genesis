'use strict';

/**
 * P7 — composition PQ × session §3 (testable sans sockets).
 * deriveSharedHybrid : même construction que deriveShared (§3 :
 * HKDF-SHA256 avec sel 'snapmesh-nt-session-v1') + moitié KEM
 * (secret = ecdh || kem). Le transport §3 reste inchangé : le point
 * d'insertion réel (ct KEM dans SESSION-KEY) est [PRÉVU] et documenté
 * dans NT_PQ_SECURITY.md. Aucune crypto maison, aucun claim quantum-safe.
 */

const crypto = require('node:crypto');

function deriveSharedHybrid(ownEcdhPriv, peerEcdhPub, kemShared) {
  const ecdh = crypto.diffieHellman({ privateKey: ownEcdhPriv, publicKey: peerEcdhPub });
  const ikm = Buffer.concat([Buffer.from(ecdh), Buffer.from(kemShared)]);
  return Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.from('snapmesh-nt-session-v1'), 'task-payload', 32));
}

module.exports = { deriveSharedHybrid };

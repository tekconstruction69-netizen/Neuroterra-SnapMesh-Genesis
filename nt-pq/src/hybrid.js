'use strict';

/**
 * NT-PQ — session hybride X25519 + ML-KEM-768 (node:crypto éprouvé,
 * jamais de crypto maison). Une seule direction KEM (initiateur
 * encapsule vers le répondeur) + ECDH mutuel :
 * secret = HKDF-SHA256(ecdh || kem) (même primitive que §3).
 * L'hybride reste sûr si l'une des deux moitiés tient.
 */

const crypto = require('node:crypto');

const KEM_ALG = 'ml-kem-768';
const ECDH_ALG = 'x25519';

/** Paire d'identités de session : { ecdh, kem } (KeyPairKeyObject). */
function genSessionIdentity() {
  return {
    ecdh: crypto.generateKeyPairSync(ECDH_ALG),
    kem: crypto.generateKeyPairSync(KEM_ALG),
  };
}

function publicOf(ident) {
  return { ecdh: ident.ecdh.publicKey, kem: ident.kem.publicKey };
}

/**
 * Côté initiateur : ECDH + encapsule vers le répondeur.
 * Retourne { secret, ct } — ct à transmettre au répondeur.
 */
function initiate(ownIdent, peerPubs, { info = 'nt-pq-hybrid-v1' } = {}) {
  const s = crypto.diffieHellman({ privateKey: ownIdent.ecdh.privateKey, publicKey: peerPubs.ecdh });
  const { ciphertext: ct, sharedKey: k } = crypto.encapsulate(peerPubs.kem);
  // P7 : `kem` (secret KEM brut, 32 o) exposé pour composition avec la
  // session §3 (deriveSharedHybrid) — le `secret` reste la voie normale.
  return { secret: deriveHybrid(s, k, info), ct, kem: Buffer.from(k), info };
}

/** Côté répondeur : ECDH + décapsule. Doit retrouver le même secret. */
function respond(ownIdent, peerEcdhPub, ct, { info = 'nt-pq-hybrid-v1' } = {}) {
  const s = crypto.diffieHellman({ privateKey: ownIdent.ecdh.privateKey, publicKey: peerEcdhPub });
  const k = crypto.decapsulate(ownIdent.kem.privateKey, ct);
  return { secret: deriveHybrid(s, k, info) };
}

function deriveHybrid(ecdhBytes, kemBytes, info) {
  // hkdfSync rend un ArrayBuffer : conversion en Buffer (API stable).
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.concat([Buffer.from(ecdhBytes), Buffer.from(kemBytes)]), Buffer.alloc(0), info, 32));
}

/** Dérive clés de session {enc, mac} depuis le secret hybride. */
function deriveSessionKeys(secret, salt = Buffer.alloc(0)) {
  return {
    enc: Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), salt, 'nt-pq-enc', 32)),
    mac: Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), salt, 'nt-pq-mac', 32)),
  };
}

module.exports = { KEM_ALG, ECDH_ALG, genSessionIdentity, publicOf, initiate, respond, deriveHybrid, deriveSessionKeys };

'use strict';

/**
 * Sessions chiffrées NT : X25519 (échange) + AES-256-GCM (confidentialité).
 * Clé éphémère par processus (régénérée au démarrage), dérivation HKDF-SHA256.
 * Utilisé pour TASK/RESULT (charges potentiellement sensibles) ; le reste
 * demeure signé en clair. Homologues : enforcement strict = [PRÉVU] M4.
 */

const crypto = require('node:crypto');

function generateEphemeral() {
  return crypto.generateKeyPairSync('x25519');
}

function exportRaw(publicKey) {
  return publicKey.export({ format: 'der', type: 'spki' });
}

function importRawPeer(spkiDer) {
  return crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
}

function deriveShared(ownPrivateKey, peerPublicKey) {
  const secret = crypto.diffieHellman({ privateKey: ownPrivateKey, publicKey: peerPublicKey });
  // Node ≥ 22 : hkdfSync renvoie un ArrayBuffer ; on normalise en Buffer.
  return Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.from('snapmesh-nt-session-v1'), 'task-payload', 32));
}

/** Chiffre un objet JSON ; retourne {iv, data, tag} base64. */
function sealPayload(aesKey, obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

/** Déchiffre ; lève sur altération (GCM) ou JSON invalide. */
function openPayload(aesKey, { iv, data, tag }) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

module.exports = { generateEphemeral, exportRaw, importRawPeer, deriveShared, sealPayload, openPayload };

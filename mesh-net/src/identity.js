'use strict';

/**
 * Identité cryptographique d'un nœud : paire Ed25519, l'identifiant du
 * nœud est l'empreinte SHA-256 hex de la clé publique (format SPKI DER).
 * Fournit signature et vérification (node:crypto, aucune dépendance).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');

function fingerprintOfPublicKey(spkiDer) {
  return crypto.createHash('sha256').update(spkiDer).digest('hex');
}

class Identity {
  constructor({ publicKey, privateKey }) {
    this.publicKey = publicKey; // KeyObject (spki)
    this.privateKey = privateKey; // KeyObject (pkcs8)
    this.spkiDer = publicKey.export({ type: 'spki', format: 'der' });
    this.id = fingerprintOfPublicKey(this.spkiDer);
    this.short = this.id.slice(0, 12);
    this.publicKeyB64 = this.spkiDer.toString('base64');
  }

  static generate() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    return new Identity({ publicKey, privateKey });
  }

  /** Persiste la clé privée (pkcs8 DER, base64) dans un fichier. */
  saveToFile(path) {
    const der = this.privateKey.export({ type: 'pkcs8', format: 'der' });
    fs.writeFileSync(path, der.toString('base64') + '\n', { mode: 0o600 });
  }

  static loadFromFile(path) {
    const b64 = fs.readFileSync(path, 'utf8').trim();
    const privateKey = crypto.createPrivateKey({
      key: Buffer.from(b64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    const publicKey = crypto.createPublicKey(privateKey);
    return new Identity({ publicKey, privateKey });
  }

  static loadOrCreate(path) {
    if (path && fs.existsSync(path)) return Identity.loadFromFile(path);
    const id = Identity.generate();
    if (path) id.saveToFile(path);
    return id;
  }

  sign(bytes) {
    return crypto.sign(null, bytes, this.privateKey);
  }

  /** Vérifie une signature avec la clé publique SPKI DER fournie. */
  static verifyWith(spkiDer, bytes, signature) {
    const pub = crypto.createPublicKey({
      key: spkiDer,
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, bytes, pub, signature);
  }
}

module.exports = { Identity, fingerprintOfPublicKey };

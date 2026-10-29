'use strict';

/**
 * NT-UCP — NT-CERT : manifeste de capacités versionné, signé, vérifiable.
 * Assemble en UN objet signé : identité (NT-ID), profil NT-CAP, backends
 * détectés (NT-COMPAT), versions de protocoles supportées. La signature
 * couvre tout sauf `sig` (canonique : JSON stable) ; vérifiable hors-ligne
 * avec la clé publique SPKI DER (base64). Ne prouve que l'ORIGINE du
 * manifeste, pas la vérité du matériel (interopérabilité crypto ≠
 * compatibilité des instructions — cf. spec).
 */

const { Identity } = require('../../mesh-net/src/identity');

const CERT_V = 1;

function stable(o) {
  return JSON.stringify(o);
}

const KNOWN_PROTOCOLS = ['snapmesh-tcp/1', 'flux/1', 'fusion-ir/1', 'pq-hybrid/1'];

/**
 * Construit et signe le manifeste.
 * profil : { nodeId, name? } ; caps : profil NT-CAP (buildCaps) ;
 * compat : { backends } (detectBackends) ; protocols/codecs/dtypes :
 * listes déclarées (intersection faite par NT-NEGOTIATE).
 */
function issueCert(identity, { nodeId, name = null, caps, compat, protocols = null, codecs = null, dtypes = null }) {
  if (!identity || typeof identity.sign !== 'function') throw new Error('cert: identité signataire requise');
  if (!nodeId) throw new Error('cert: nodeId requis');
  if (!caps || typeof caps !== 'object') throw new Error('cert: profil NT-CAP requis');
  if (!compat || typeof compat !== 'object') throw new Error('cert: compat requise');
  const manifest = {
    v: CERT_V,
    at: new Date().toISOString(),
    nodeId,
    name,
    caps,
    backends: Object.entries(compat.backends || {})
      .filter(([, b]) => b && b.available)
      .map(([beName, b]) => ({ name: beName, dtypes: b.dtypes || [] })),
    protocols: protocols || KNOWN_PROTOCOLS.filter((p) => p !== 'pq-hybrid/1'),
    codecs: codecs || ['raw', 'deflate', 'gzip', 'brotli'],
    dtypes: dtypes || ['fp64', 'fp32', 'int8'],
  };
  const sig = identity.sign(Buffer.from(stable(manifest))).toString('base64');
  return { ...manifest, sig };
}

/** Vérifie un manifeste avec la clé publique SPKI DER (Buffer). */
function verifyCert(manifest, spkiDer) {
  try {
    if (!manifest || typeof manifest !== 'object' || manifest.v !== CERT_V) return false;
    if (typeof manifest.sig !== 'string') return false;
    if (typeof manifest.nodeId !== 'string' || !manifest.nodeId) return false;
    if (!Array.isArray(manifest.backends)) return false;
    if (!Buffer.isBuffer(spkiDer)) return false;
    const { sig, ...rest } = manifest;
    return Identity.verifyWith(spkiDer, Buffer.from(stable(rest)), Buffer.from(sig, 'base64'));
  } catch {
    return false;
  }
}

module.exports = { CERT_V, KNOWN_PROTOCOLS, issueCert, verifyCert };

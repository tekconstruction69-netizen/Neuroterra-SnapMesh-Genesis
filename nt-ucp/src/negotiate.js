'use strict';

/**
 * NT-UCP — NT-NEGOTIATE : négociation authentifiée des capacités.
 * Phases (transport §3, jamais de crypto propriétaire) :
 *  1. A → B : NEG_HELLO { nonceA, certA } (manifeste signé NT-CERT).
 *  2. B → A : NEG_SELECT { nonceA, nonceB, certB, selected }.
 * A vérifie certB, recalcule l'intersection et refuse tout désaccord
 * (`neg-disagree`). Nonces anti-rejeu (cache partagé nt-pq).
 * Négocié : protocole, dtype commun (préférence : fp32 > fp64 > int8 —
 * le plus interopérable d'abord, pas le plus précis), codec commun
 * (préférence : gzip > deflate > brotli > raw — mesuré NT-Flux),
 * crypto de session (pq-hybrid si les deux l'annoncent, sinon
 * x25519 — JAMAIS de downgrade silencieux : le choix figure dans
 * `selected` vérifié des deux côtés).
 */

const crypto = require('node:crypto');
const { verifyCert } = require('./cert');
const { NonceCache } = require('../../nt-pq/src/sigs');

const NEG_V = 1;
const DTYPE_PREF = ['fp32', 'fp64', 'int8'];
const CODEC_PREF = ['gzip', 'deflate', 'brotli', 'raw'];

function isObj(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o);
}

function intersect(a, b) {
  const sb = new Set(b || []);
  return (a || []).filter((x) => sb.has(x));
}

/** Arbitrage déterministe d'une intersection (lève si vide). */
function arbitrate(local, peer) {
  const protocols = intersect(local.protocols, peer.protocols);
  if (!protocols.length) throw new Error('neg-échec: aucun protocole commun');
  const dtypes = intersect(local.dtypes, peer.dtypes);
  if (!dtypes.length) throw new Error('neg-échec: aucun dtype commun');
  const codecs = intersect(local.codecs, peer.codecs);
  if (!codecs.length) throw new Error('neg-échec: aucun codec commun');
  const beLocal = new Set((local.backends || []).map((x) => x.name));
  const bePeer = new Set((peer.backends || []).map((x) => x.name));
  const backends = [...beLocal].filter((x) => bePeer.has(x));
  if (!backends.length) throw new Error('neg-échec: aucun backend commun');
  const cryptoChoice = local.protocols.includes('pq-hybrid/1') && peer.protocols.includes('pq-hybrid/1')
    ? 'pq-hybrid/1'
    : 'x25519';
  return {
    protocol: protocols.includes('fusion-ir/1') ? 'fusion-ir/1' : protocols[0],
    dtype: DTYPE_PREF.find((d) => dtypes.includes(d)),
    codec: CODEC_PREF.find((c) => codecs.includes(c)),
    crypto: cryptoChoice,
    backends,
  };
}

/**
 * Phase 1 (A) : construit NEG_HELLO. Phase 2 (B) : vérifie + arbitre +
 * répond NEG_SELECT. Phase 3 (A) : vérifie + recalcule (désaccord=refus).
 * Chaque phase lève un motif explicite ; le fil = copies JSON.
 */
function helloPhase(certA) {
  return JSON.parse(JSON.stringify({ v: NEG_V, nonceA: crypto.randomBytes(8).toString('hex'), cert: certA }));
}
function selectPhase(hello, certB, keyA, nonces) {
  if (!nonces.check(`A:${hello.nonceA}`)) throw new Error('neg-rejeu: nonceA');
  if (!verifyCert(hello.cert, keyA.spkiDer)) throw new Error('neg-rejet: certA invalide');
  const selected = arbitrate(certB, hello.cert);
  const select = JSON.parse(JSON.stringify({
    v: NEG_V, nonceA: hello.nonceA, nonceB: crypto.randomBytes(8).toString('hex'),
    cert: certB, selected,
  }));
  if (!nonces.check(`B:${select.nonceB}`)) throw new Error('neg-rejeu: nonceB');
  return select;
}
function verifyPhase(hello, select, certA, keyB, nonces) {
  void nonces;
  if (select.nonceA !== hello.nonceA) throw new Error('neg-rejet: nonceA non renvoyé');
  if (!verifyCert(select.cert, keyB.spkiDer)) throw new Error('neg-rejet: certB invalide');
  const selectedA = arbitrate(certA, select.cert);
  if (JSON.stringify(selectedA) !== JSON.stringify(select.selected)) {
    throw new Error('neg-disagree: sélection B non reproductible');
  }
  return selectedA;
}

/**
 * Rejoue les 2 phases en local (copies JSON = fil simulé).
 * Retourne { selected, ms, bytes } ou lève (motif explicite).
 */
function negotiatePair(certA, keyA, certB, keyB, { nonces = new NonceCache({}) } = {}) {
  const t0 = process.hrtime.bigint();
  const hello = helloPhase(certA);
  const select = selectPhase(hello, certB, keyA, nonces);
  const selected = verifyPhase(hello, select, certA, keyB, nonces);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const bytes = JSON.stringify(hello).length + JSON.stringify(select).length;
  return { selected, ms, bytes };
}

module.exports = { NEG_V, DTYPE_PREF, CODEC_PREF, arbitrate, negotiatePair, helloPhase, selectPhase, verifyPhase };

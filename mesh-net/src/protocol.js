'use strict';

/**
 * Protocole SnapMesh v1 : enveloppes JSON signées sur TCP (une par ligne).
 *
 * Enveloppe : { v, type, from, ts, payload, pub?, sig }
 * - `pub` (SPKI DER base64) obligatoire sur HELLO, interdit ailleurs.
 * - `sig` = Ed25519(canonical({v,type,from,ts,payload})).
 * - Réception : HELLO vérifié contre `pub` + id == empreinte(pub) ;
 *   autres types vérifiés contre la clé apprise via HELLO.
 * - Fenêtre anti-rejet : ts à ±120 s / +30 s ; seq heartbeat monotone.
 */

const { Identity, fingerprintOfPublicKey } = require('./identity');

const VERSION = 1;
const MAX_LINE_BYTES = 1024 * 1024; // garde-fou trames
const TS_PAST_MS = 120_000;
const TS_FUTURE_MS = 30_000;

function canonical({ v, type, from, ts, payload, n }) {
  // Ordre de clés fixe et stable des deux côtés. `n` (nonce unique par
  // enveloppe) est signé : il fonde l'anti-rejeu NT-ID.
  return Buffer.from(JSON.stringify({ v, type, from, ts, payload, n }));
}

/** Nom lisible NT : classification d'affichage, JAMAIS une preuve d'identité. */
function validNtName(name) {
  return typeof name === 'string' && /^NT-[A-Z0-9-]{1,24}$/.test(name);
}

function seal(identity, type, payload) {
  const crypto = require('node:crypto');
  const env = { v: VERSION, type, from: identity.id, ts: Date.now(), payload, n: crypto.randomBytes(8).toString('hex') };
  const sig = identity.sign(canonical(env));
  const out = { ...env, sig: sig.toString('base64') };
  if (type === 'HELLO') out.pub = identity.publicKeyB64;
  return out;
}

function encode(env) {
  return JSON.stringify(env) + '\n';
}

/**
 * Vérifie une enveloppe décodée.
 * @param {object} env enveloppe parsée
 * @param {Buffer|null} knownPub clé SPKI DER déjà apprise pour env.from (null si inconnue)
 * @returns {{ok:true,pub:Buffer}|{ok:false,reason:string}}
 */
function verifyEnvelope(env, knownPub) {
  if (!env || typeof env !== 'object') return { ok: false, reason: 'bad-shape' };
  if (env.v !== VERSION) return { ok: false, reason: 'bad-version' };
  if (typeof env.from !== 'string' || typeof env.sig !== 'string') {
    return { ok: false, reason: 'bad-fields' };
  }
  if (typeof env.ts !== 'number' || !Number.isFinite(env.ts)) {
    return { ok: false, reason: 'bad-ts' };
  }
  if (typeof env.n !== 'string' || !env.n) {
    return { ok: false, reason: 'bad-nonce' };
  }
  const now = Date.now();
  if (env.ts < now - TS_PAST_MS || env.ts > now + TS_FUTURE_MS) {
    return { ok: false, reason: 'stale-ts' };
  }
  let pub = knownPub;
  if (env.type === 'HELLO') {
    if (typeof env.pub !== 'string') return { ok: false, reason: 'hello-no-pub' };
    pub = Buffer.from(env.pub, 'base64');
    if (fingerprintOfPublicKey(pub) !== env.from) {
      return { ok: false, reason: 'id-pub-mismatch' };
    }
  } else if (!pub) {
    return { ok: false, reason: 'unknown-sender' };
  }
  let sig;
  try {
    sig = Buffer.from(env.sig, 'base64');
  } catch {
    return { ok: false, reason: 'bad-sig-encoding' };
  }
  let ok;
  try {
    ok = Identity.verifyWith(pub, canonical(env), sig);
  } catch {
    return { ok: false, reason: 'bad-key' }; // clé malformée : rejet, jamais d'exception
  }
  return ok ? { ok: true, pub } : { ok: false, reason: 'bad-signature' };
}

/**
 * Découpe un flux TCP en lignes JSON. Seuls les objets simples sont remis
 * à onMessage ; tout le reste (null, tableaux, primitifs, JSON invalide,
 * trame géante) part en onError sans jamais lever.
 * Le décodage UTF-8 tolère les caractères multi-octets fragmentés entre
 * deux segments TCP (StringDecoder).
 */
const { StringDecoder } = require('node:string_decoder');

class LineFramer {
  constructor(onMessage, onError) {
    this.buf = '';
    this.decoder = new StringDecoder('utf8');
    this.onMessage = onMessage;
    this.onError = onError;
  }

  push(chunk) {
    this.buf += this.decoder.write(chunk);
    if (this.buf.length > MAX_LINE_BYTES + 4096) {
      this.onError(new Error('frame-too-large'));
      this.buf = '';
      return;
    }
    let idx;
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.length > MAX_LINE_BYTES) {
        this.onError(new Error('frame-too-large'));
        continue;
      }
      if (!line.trim()) continue;
      let env;
      try {
        env = JSON.parse(line);
      } catch {
        this.onError(new Error('bad-json'));
        continue;
      }
      if (!env || typeof env !== 'object' || Array.isArray(env)) {
        this.onError(new Error('bad-frame'));
        continue;
      }
      this.onMessage(env);
    }
  }
}

module.exports = {
  VERSION,
  MAX_LINE_BYTES,
  canonical,
  seal,
  encode,
  verifyEnvelope,
  validNtName,
  LineFramer,
};

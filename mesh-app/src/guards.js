'use strict';

/**
 * P2 — gardes de l'API locale Genesis (testables sans sockets).
 * - MAX_BODY : taille max des requêtes JSON (413 au-delà).
 * - originOk(req) : refuse les Origin tierces (CSRF de sites web) ;
 *   accepte absence d'Origin (curl/tests) et boucle locale même hôte.
 * - tokenOk(req, token) : jeton local exigé pour les POST sensibles.
 */

const MAX_BODY = 256 * 1024;

function newToken() {
  return require('node:crypto').randomBytes(24).toString('hex');
}

function originOk(req) {
  const o = req && req.headers ? req.headers.origin : undefined;
  if (!o) return true;
  try {
    const u = new URL(o);
    const host = req.headers.host || '';
    return u.host === host && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

function tokenOk(req, token) {
  const t = req && req.headers ? req.headers['x-genesis-token'] : undefined;
  return typeof t === 'string' && t.length > 0 && t === token;
}

module.exports = { MAX_BODY, newToken, originOk, tokenOk };

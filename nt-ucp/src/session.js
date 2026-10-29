'use strict';

/**
 * NT-UCP P4 — Negotiator : conduit les 3 phases sur le transport réel.
 * Envoi via sendFn(type, payload) (ex. node.sendEncrypted), réception via
 * handleMessage({type, from, payload}). Les enveloppes réseau (défi,
 * signature, anti-rejeu NT-ID) sont vérifiées par mesh-net ; ici on
 * vérifie les CERTIFICATS et l'accord (négociation authentifiée).
 * Émet via events : 'negotiated' {peer, selected, bytes}, 'neg-failed'.
 */

const { EventEmitter } = require('node:events');
const { helloPhase, selectPhase, verifyPhase } = require('./negotiate');
const { NonceCache } = require('../../nt-pq/src/sigs');

class Negotiator extends EventEmitter {
  /**
   * @param {object} o cert (NT-CERT signé), key (Identity), sendFn,
   * nonces (NonceCache partagé), peerPubs : Map peerId -> spkiDer.
   */
  constructor({ cert, key, sendFn, nonces = null, peerPubs = new Map() } = {}) {
    super();
    if (!cert || !key || typeof sendFn !== 'function') throw new Error('negotiator: cert/key/sendFn requis');
    this.cert = cert;
    this.key = key;
    this.sendFn = sendFn;
    this.nonces = nonces || new NonceCache({});
    this.peerPubs = peerPubs;
    this.pending = new Map(); // peerId -> hello envoyé (phase 1)
    this.awaiting = new Map(); // peerId -> sélection proposée (rôle B, en attente DONE)
    this.done = new Map(); // peerId -> selected
    this.stats = { sent: 0, received: 0, bytes: 0, failed: 0 };
  }

  /** Démarre la négociation vers un pair (phase 1). */
  start(peerId) {
    if (this.done.has(peerId)) return this.done.get(peerId);
    const hello = helloPhase(this.cert);
    this.pending.set(peerId, hello);
    this._send(peerId, 'NEG_HELLO', hello);
    return null;
  }

  /** Traite un message applicatif entrant. Retourne true si consommé. */
  handleMessage({ type, from, payload }) {
    if (type !== 'NEG_HELLO' && type !== 'NEG_SELECT' && type !== 'NEG_DONE' && type !== 'NEG_REJECT') return false;
    this.stats.received++;
    try {
      if (type === 'NEG_HELLO') {
        // Rôle B : vérifie, arbitre, répond + mémorise sa sélection.
        const select = selectPhase(payload, this.cert, this._peerKey(from), this.nonces);
        this.awaiting.set(from, select.selected);
        this._send(from, 'NEG_SELECT', select);
      } else if (type === 'NEG_SELECT') {
        // Rôle A : vérifie l'accord, accuse réception (ou rejette).
        const hello = this.pending.get(from);
        if (!hello) throw new Error('neg-inattendu: SELECT sans HELLO');
        try {
          const selected = verifyPhase(hello, payload, this.cert, this._peerKey(from), this.nonces);
          this.pending.delete(from);
          this.done.set(from, selected);
          this._send(from, 'NEG_DONE', { nonceA: hello.nonceA });
          this.emit('negotiated', { peer: from, selected, bytes: this.stats.bytes });
        } catch (e) {
          this._send(from, 'NEG_REJECT', { nonceA: hello.nonceA, reason: String((e && e.message) || e).slice(0, 120) });
          throw e;
        }
      } else if (type === 'NEG_DONE') {
        // Rôle B : l'initiateur a validé → accord conclu des deux côtés.
        const sel = this.awaiting.get(from);
        if (!sel) throw new Error('neg-inattendu: DONE sans SELECT');
        this.awaiting.delete(from);
        this.done.set(from, sel);
        this.emit('negotiated', { peer: from, selected: sel, bytes: this.stats.bytes });
      } else {
        // NEG_REJECT : l'initiateur conteste → B abandonne (signalé).
        this.awaiting.delete(from);
        throw new Error(`neg-rejet-pair: ${payload && payload.reason ? payload.reason : 'sans motif'}`);
      }
    } catch (e) {
      this.stats.failed++;
      this.emit('neg-failed', { peer: from, reason: String((e && e.message) || e).slice(0, 160) });
    }
    return true;
  }

  _peerKey(peerId) {
    const pub = this.peerPubs.get(peerId);
    if (!pub) throw new Error(`neg-inconnu: clé publique de ${String(peerId).slice(0, 12)} non apprise (défi NT-ID requis)`);
    return { spkiDer: pub };
  }

  _send(peerId, type, payload) {
    const n = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    this.stats.bytes += n;
    this.stats.sent++;
    this.sendFn(peerId, type, payload);
  }
}

module.exports = { Negotiator };

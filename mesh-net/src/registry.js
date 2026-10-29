'use strict';

/**
 * Registre des nœuds : état réel et observable de chaque pair connu.
 * États : connected → suspect → dead. Un pair `dead` est retiré du
 * snapshot actif mais gardé en historique pour le diagnostic.
 */

const STATES = ['connected', 'suspect', 'dead'];

class Registry {
  constructor() {
    this.peers = new Map(); // id -> fiche
  }

  upsert({ id, name, caps, address, pubB64 }) {
    let p = this.peers.get(id);
    if (!p) {
      p = {
        id,
        short: id.slice(0, 12),
        name: name || id.slice(0, 12),
        caps: caps || {},
        address: address || null,
        pubB64: pubB64 || null,
        state: 'connected',
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        lastSeq: -1,
        transitions: [],
        sessionVerified: false, // défi NT-ID réussi requis pour les tâches
        revoked: null, // {reason, at} si révoqué
        successor: null, // nouvel id après rotation de clé
      };
      this.peers.set(id, p);
    } else {
      if (name) p.name = name;
      if (caps) p.caps = caps;
      if (address) p.address = address;
      if (pubB64) p.pubB64 = pubB64;
    }
    return p;
  }

  touch(id, seq) {
    const p = this.peers.get(id);
    if (!p) return null;
    if (typeof seq === 'number') {
      if (seq <= p.lastSeq) return 'stale-seq';
      p.lastSeq = seq;
    }
    p.lastSeen = Date.now();
    if (p.state !== 'connected') this.setState(id, 'connected');
    return p;
  }

  setState(id, state) {
    const p = this.peers.get(id);
    if (!p || p.state === state) return p;
    if (!STATES.includes(state)) throw new Error(`bad-state: ${state}`);
    p.transitions.push({ from: p.state, to: state, at: Date.now() });
    p.state = state;
    return p;
  }

  get(id) {
    return this.peers.get(id) || null;
  }

  setSessionVerified(id, v) {
    const p = this.peers.get(id);
    if (p) p.sessionVerified = !!v;
  }

  isSessionVerified(id) {
    const p = this.peers.get(id);
    return !!(p && p.sessionVerified);
  }

  revoke(id, reason) {
    const p = this.peers.get(id);
    if (p && !p.revoked) p.revoked = { reason, at: Date.now() };
  }

  isRevoked(id) {
    const p = this.peers.get(id);
    return !!(p && p.revoked);
  }

  setSuccessor(oldId, newId) {
    const p = this.peers.get(oldId);
    if (p) p.successor = newId;
  }

  /** NT-CAP live : RTT estimé + RAM fraîche sur la fiche existante. */
  setRtt(id, ms) {
    const p = this.peers.get(id);
    if (p && Number.isFinite(ms) && ms >= 0 && ms < 60000) {
      p.caps = p.caps || {};
      p.caps.net = { ...((p.caps && p.caps.net) || {}), rttMs: Math.round(ms) };
    }
  }

  setRamFree(id, free) {
    const p = this.peers.get(id);
    if (p && Number.isFinite(free) && free >= 0) {
      p.caps = p.caps || {};
      p.caps.ram = { ...((p.caps && p.caps.ram) || {}), free: Math.round(free) };
      p.caps.updatedAt = Date.now();
    }
  }

  /** Pairs vivants non révoqués : la vue d'exploitation. */
  live() {
    const now = Date.now();
    return [...this.peers.values()]
      .filter((p) => p.state !== 'dead' && !p.revoked)
      .map((p) => ({ ...p, lastSeenAgoMs: now - p.lastSeen }));
  }

  /** Historique complet incluant les morts (diagnostic). */
  all() {
    const now = Date.now();
    return [...this.peers.values()].map((p) => ({
      ...p,
      lastSeenAgoMs: now - p.lastSeen,
    }));
  }
}

module.exports = { Registry, STATES };

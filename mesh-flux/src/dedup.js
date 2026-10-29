'use strict';

/**
 * Déduplication NT-Flux : cache de fragments par empreinte sha256.
 * - `put` : stocke (quotas : entrées + octets, éviction FIFO la plus
 *   ancienne) ; `confirm` ne fait sens qu'après accusé du destinataire :
 *   le sender ne remplace un plein par une ref qu'après `ack` explicite.
 * - Intégrité : `get` revérifie l'empreinte (corrompu ⇒ évincé + null).
 * - Expiration TTL ; partition PAR EXPÉDITEUR côté exécutant (jamais de
 *   mélange inter-utilisateurs — voir docs/NT_FLUX_SECURITY.md).
 */

const crypto = require('node:crypto');

const hashOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

class DedupStore {
  constructor({ maxEntries = 512, maxBytes = 8 * 1024 * 1024, ttlMs = 10 * 60 * 1000 } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.map = new Map(); // hash -> {data, at, bytes}
    this.bytes = 0;
    this.stats = { hits: 0, misses: 0, evicted: 0, expired: 0, corrupt: 0, refused: 0 };
  }

  put(buf) {
    const data = Buffer.from(buf);
    const h = hashOf(data);
    if (this.map.has(h)) return { hash: h, stored: false, duplicate: true };
    if (data.length > this.maxBytes) {
      this.stats.refused++;
      return { hash: h, stored: false, duplicate: false, reason: 'trop-gros' };
    }
    this._gc(Date.now());
    while ((this.map.size >= this.maxEntries || this.bytes + data.length > this.maxBytes) && this.map.size) {
      const oldest = this.map.keys().next().value;
      this._drop(oldest, 'evicted');
    }
    this.map.set(h, { data, at: Date.now(), bytes: data.length });
    this.bytes += data.length;
    return { hash: h, stored: true, duplicate: false };
  }

  get(hash) {
    const e = this.map.get(hash);
    if (!e) {
      this.stats.misses++;
      return null;
    }
    if (Date.now() - e.at > this.ttlMs) {
      this._drop(hash, 'expired');
      this.stats.misses++;
      return null;
    }
    if (hashOf(e.data) !== hash) {
      this._drop(hash, 'corrupt'); // intégrité violée : jamais servi
      this.stats.misses++;
      return null;
    }
    this.stats.hits++;
    return e.data;
  }

  has(hash) {
    return this.get(hash) !== null;
  }

  _drop(hash, why) {
    const e = this.map.get(hash);
    if (!e) return;
    this.map.delete(hash);
    this.bytes -= e.bytes;
    this.stats[why === 'evicted' ? 'evicted' : why === 'expired' ? 'expired' : 'corrupt']++;
  }

  _gc(now) {
    for (const [h, e] of this.map) {
      if (now - e.at > this.ttlMs) this._drop(h, 'expired');
    }
  }

  describe() {
    return { entries: this.map.size, bytes: this.bytes, maxEntries: this.maxEntries, maxBytes: this.maxBytes, ttlMs: this.ttlMs, ...this.stats };
  }
}

module.exports = { DedupStore, hashOf };

'use strict';

/**
 * NT-FUSION — registre vérifiable hors-chaîne (M6).
 * Registre append-only : chaque entrée lie {seq, kind, body, prevHash}
 * par sha256 ; les reçus embarquent leur signature (Ed25519 §7 ou
 * ML-DSA nt-pq). Vérification hors-ligne : chaîne intacte + signatures
 * valides avec les clés connues. AUCUNE blockchain requise ; une
 * intégration chaîne (ancrage périodique du head) reste [PRÉVU] et
 * optionnelle. Sépare : identité (clé), réception (reçu signé),
 * résultat vérifié (empreintes), preuve de calcul (quorum/re-calcul,
 * hors registre).
 */

const crypto = require('node:crypto');

const LEDGER_V = 1;

function hashEntry(e) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([e.v, e.seq, e.kind, e.body, e.prevHash]), 'utf8')
    .digest('hex');
}

class Ledger {
  constructor() {
    this.entries = [];
  }
  head() {
    return this.entries.length ? this.entries[this.entries.length - 1].hash : 'GENESIS';
  }
  /** Ajoute une entrée (body = reçu signé ou faisceau). Retourne l'entrée. */
  append(kind, body) {
    if (typeof kind !== 'string' || !kind) throw new Error('registre: kind requis');
    if (!body || typeof body !== 'object') throw new Error('registre: body objet requis');
    const e = { v: LEDGER_V, seq: this.entries.length, kind, body, prevHash: this.head() };
    e.hash = hashEntry(e);
    this.entries.push(e);
    return e;
  }
  /**
   * Vérifie hors-ligne : ordre, chaînage, et signatures des reçus via
   * verify(entry) fourni par l'appelant (route Ed25519/ML-DSA selon kind).
   * Retourne { ok:true, checked } ou { ok:false, reason, seq }.
   */
  verify(verifyEntry = null) {
    let prev = 'GENESIS';
    let checked = 0;
    for (const e of this.entries) {
      if (e.seq !== checked) return { ok: false, reason: `ordre rompu (seq ${e.seq} ≠ ${checked})`, seq: e.seq };
      if (e.prevHash !== prev) return { ok: false, reason: `chaînage rompu (seq ${e.seq})`, seq: e.seq };
      if (hashEntry(e) !== e.hash) return { ok: false, reason: `empreinte altérée (seq ${e.seq})`, seq: e.seq };
      if (verifyEntry) {
        const r = verifyEntry(e);
        if (r !== true) return { ok: false, reason: `signature invalide (seq ${e.seq}) : ${r}`, seq: e.seq };
      }
      prev = e.hash;
      checked++;
    }
    return { ok: true, checked };
  }
  toJSON() {
    return { v: LEDGER_V, entries: this.entries };
  }
  static fromJSON(j) {
    if (!j || j.v !== LEDGER_V || !Array.isArray(j.entries)) throw new Error('registre: JSON invalide');
    const l = new Ledger();
    l.entries = j.entries;
    return l;
  }
}

module.exports = { LEDGER_V, Ledger, hashEntry };

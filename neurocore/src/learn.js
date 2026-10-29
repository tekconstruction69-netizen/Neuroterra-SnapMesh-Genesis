'use strict';

/**
 * NT-LEARN — apprentissage en ligne des coûts réels (EWMA + garde-fous).
 * Clé : `${op}|${workerId}|${dtype}`. Fiche : { done, failed, msEwma,
 * flops, lastMs, updatedAt }. Approche retenue : EWMA (alpha 0.3) —
 * modèle statistique léger, O(1), sans entraînement, avec :
 * - démarrage prudent : tant que done < 3, l'incertitude reste haute
 *   (NT-COST élargit) et le choix reste déterministe (pas d'UCB qui
 *   explorerait au hasard des workers incompatibles ou lents) ;
 * - hystérésis : on ne change de worker préféré que si le gain prédit
 *   dépasse 10 % (anti-oscillation) ;
 * - détection de dérive : si |ms - msEwma| > 3×msEwma deux fois de
 *   suite, la fiche est réinitialisée (comportement changé) ;
 * - historique borné (500 fiches max, LRU), aucune donnée personnelle
 *   (que des durées et comptes — vie privée par construction).
 * Toute adaptation reste sous validation déterministe (NT-COST refuse
 * l'incompatible quel que soit l'apprentissage).
 */

const LEARN_V = 1;
const ALPHA = 0.3;
const MIN_SAMPLES = 3;
const HYSTERESIS = 0.1; // gain minimal pour changer de préférence
const MAX_KEYS = 500;

function keyOf(op, workerId, dtype) {
  return `${op}|${workerId}|${dtype}`;
}

class Learner {
  constructor({ alpha = ALPHA } = {}) {
    this.alpha = alpha;
    this.stats = new Map(); // key -> fiche
    this.surprises = new Map(); // key -> compteur de dérive consécutive
  }
  /** Enregistre une exécution réelle. flopsHint : flops du nœud. */
  observe({ op, workerId, dtype, ms, ok = true, flops = 0 }) {
    if (typeof op !== 'string' || typeof workerId !== 'string' || typeof dtype !== 'string') {
      throw new Error('learn: op/workerId/dtype requis');
    }
    if (!Number.isFinite(ms) || ms < 0) throw new Error('learn: ms invalide');
    const k = keyOf(op, workerId, dtype);
    let f = this.stats.get(k);
    if (!f) {
      f = { done: 0, failed: 0, msEwma: 0, flops: 0, updatedAt: Date.now() };
      this.stats.set(k, f);
    }
    if (!ok) {
      f.failed++;
      f.updatedAt = Date.now();
      return f;
    }
    // Dérive : surprise répétée => réinitialisation (comportement changé).
    // Le point aberrant N'EST PAS appris (ewma gelée) pour que la 2e
    // surprise soit jugée contre l'ancien régime, pas contre la dérive.
    if (f.done >= MIN_SAMPLES && f.msEwma > 0 && Math.abs(ms - f.msEwma) > 3 * f.msEwma) {
      const n = (this.surprises.get(k) || 0) + 1;
      this.surprises.set(k, n);
      f.updatedAt = Date.now();
      if (n >= 2) {
        f.done = 0;
        f.failed = 0;
        f.msEwma = 0;
        this.surprises.set(k, 0);
      }
      return f;
    }
    this.surprises.set(k, 0);
    f.done++;
    f.msEwma = f.done === 1 ? ms : this.alpha * ms + (1 - this.alpha) * f.msEwma;
    if (flops > 0) {
      const inst = (flops / Math.max(ms, 1e-3)) * 1000;
      f.flops = f.flops > 0 ? this.alpha * inst + (1 - this.alpha) * f.flops : inst;
    }
    f.updatedAt = Date.now();
    if (this.stats.size > MAX_KEYS) {
      // Éviction LRU (borne mémoire).
      let oldest = null;
      for (const [kk, vv] of this.stats) {
        if (!oldest || vv.updatedAt < oldest[1].updatedAt) oldest = [kk, vv];
      }
      this.stats.delete(oldest[0]);
    }
    return f;
  }
  /** Fiche pour NT-COST (null si jamais observé). */
  get(op, workerId, dtype) {
    return this.stats.get(keyOf(op, workerId, dtype)) || null;
  }
  /** Erreur de prédiction |ms - msEwma| / msEwma (null si insuffisant). */
  predictError(op, workerId, dtype, ms) {
    const f = this.get(op, workerId, dtype);
    if (!f || f.done < MIN_SAMPLES || f.msEwma <= 0) return null;
    return Math.abs(ms - f.msEwma) / f.msEwma;
  }
  /**
   * Préférence avec hystérésis : ne change de worker que si le nouveau
   * coût prédit bat l'ancien d'au moins HYSTERESIS. Retourne le worker
   * retenu parmi les candidats {id, costMs}.
   */
  prefer(currentId, cands) {
    if (!cands.length) return currentId;
    const cur = cands.find((c) => c.id === currentId);
    let best = cands[0];
    for (const c of cands) {
      if (c.costMs < best.costMs) best = c;
    }
    if (!cur) return best.id;
    if (best.costMs < cur.costMs * (1 - HYSTERESIS)) return best.id;
    return currentId;
  }
  toJSON() {
    return { v: LEARN_V, stats: [...this.stats.entries()] };
  }
  static fromJSON(j) {
    if (!j || j.v !== LEARN_V || !Array.isArray(j.stats)) throw new Error('learn: JSON invalide');
    const l = new Learner();
    l.stats = new Map(j.stats);
    return l;
  }
}

module.exports = { LEARN_V, ALPHA, MIN_SAMPLES, HYSTERESIS, Learner, keyOf };

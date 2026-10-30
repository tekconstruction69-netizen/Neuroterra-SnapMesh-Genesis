'use strict';

/**
 * Sélection intelligente du transport (SnapMesh Universal).
 * Entrées : capacités locales et du pair (compatibilité annoncée),
 * permissions accordées, mesures (rttMs, débit, stabilité) quand elles
 * existent. Priorité : direct (Wi-Fi Direct/Aware) si les DEUX côtés
 * sont confirmés compatibles > BLE léger (découverte/micro-messages,
 * jamais de tâche IA) > Internet chiffré (LAN/relais existants).
 * Règles : sans compatibilité confirmée des deux côtés, le direct est
 * ÉCARTÉ (jamais supposé) ; sans permission, le transport est ÉCARTÉ ;
 * sans mesure, le choix se fait sur compatibilité + permission, avec
 * motif. La sélection ne contourne jamais STOP ni les protections.
 */

const ORDER = ['direct', 'ble-leger', 'internet'];

function evaluateTransport(kind, local, peer, measures = {}) {
  const L = (local && local[kind]) || {};
  const P = (peer && peer[kind]) || {};
  if (L.compatible !== true || P.compatible !== true) {
    return { kind, retenu: false, motif: 'compatibilité non confirmée des deux côtés' };
  }
  if (L.permission !== true || P.permission !== true) {
    return { kind, retenu: false, motif: 'permission manquante d\u2019un côté' };
  }
  const m = measures[kind] || {};
  const score =
    (Number.isFinite(m.debitMbps) ? Math.min(100, m.debitMbps) : 10) -
    (Number.isFinite(m.rttMs) ? Math.min(100, m.rttMs / 10) : 5) +
    (Number.isFinite(m.stabilite) ? m.stabilite * 10 : 0);
  return { kind, retenu: true, score: +score.toFixed(2), mesure: !!(m.debitMbps || m.rttMs) };
}

/** Retourne { choisi, candidats } — choisi null si aucun transport. */
function selectTransport(local, peer, measures = {}) {
  const candidats = ORDER.map((k) => evaluateTransport(k, local, peer, measures));
  const rank = (k) => ORDER.indexOf(k);
  const ok = candidats.filter((c) => c.retenu)
    .sort((a, b) => (rank(a.kind) - rank(b.kind)) || (b.score - a.score));
  return { choisi: ok[0] ? ok[0].kind : null, candidats };
}

module.exports = { ORDER, evaluateTransport, selectTransport };

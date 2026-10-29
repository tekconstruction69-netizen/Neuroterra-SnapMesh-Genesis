'use strict';

/**
 * NT-RECOMPOSE — choix de partition et de coupe (sans Muse).
 * - chooseCut : pour une arête producteur→consommateur de dtypes
 *   différents via cast, choisir de transférer AVANT le cast (gros,
 *   précis) ou APRÈS (petit, quantifié) au coût total. Sémantique
 *   conservée : le cast reste explicite, tolérance = erreur de
 *   quantification mesurée (borne nt-compat).
 * - chooseSplit : monolithe vs K fragments parallèles (même op sur
 *   parts) : compare calcul/K + fusion + transferts. K borné (2..8),
 *   fragments ≥ seuil (pas de micro-tâches).
 * Les deux retournent { choice, costs } expliquables et auditables.
 */

function chooseCut({ bytesBefore, bytesAfter, bps, tCastMs = 0, tCalcSavedMs = 0 }) {
  if (!(bytesBefore > 0) || !(bytesAfter > 0) || !(bps > 0)) {
    throw new Error('recompose: octets/débit requis');
  }
  const tBefore = (bytesBefore / bps) * 1000;
  const tAfter = (bytesAfter / bps) * 1000 + tCastMs - tCalcSavedMs;
  const choice = tAfter < tBefore ? 'apres-cast' : 'avant-cast';
  return { choice, costs: { avantMs: tBefore, apresMs: tAfter } };
}

/**
 * Monolithe vs split : tMono contre (tFragMax + tFusion + tTransfert).
 * sizes : octets par fragment ; calcMs : temps par fragment (parallèle) ;
 * tFusionMs, tTransfertMs mesurés ou estimés.
 */
function chooseSplit({ tMonoMs, fragCalcMs, tFusionMs = 0, tTransfertMs = 0, k = 2 }) {
  if (!(tMonoMs > 0) || !(fragCalcMs > 0)) throw new Error('recompose: temps requis');
  if (!Number.isInteger(k) || k < 2 || k > 8) throw new Error('recompose: k 2..8');
  const tSplit = fragCalcMs + tFusionMs + tTransfertMs;
  const choice = tSplit < tMonoMs * 0.9 ? `split-${k}` : 'monolithe'; // hystérésis 10 %
  return { choice, costs: { monoMs: tMonoMs, splitMs: tSplit, k } };
}

module.exports = { chooseCut, chooseSplit };

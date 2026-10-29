'use strict';

/**
 * NT-COST — modèle prédictif des coûts de placement (sans Muse).
 * Coût(nœud → worker) = tCalcul + tTransfert + tConversion + tCodec,
 * chaque terme documenté, quantifié, avec incertitude :
 * - tCalcul = flops / flopsAppris (nt-learn ; défaut flops mesuré sonde).
 * - tTransfert = octets / débitMesuré (défaut 25 Mio/s loopback documenté).
 * - tConversion = octets / débitCast (mesuré une fois, calibré).
 * - tCodec = pack estimé via politique NT-Flux (sélection sans émission).
 * Fiabilité : score 0..1 (succès observés) ; risque déconnexion :
 * pénalité multiplicative. Tout plan incompatible => refus motivé.
 * Retour : { ok, costMs, parts, uncertainty } ou { ok:false, reason }.
 */

const { checkAssignment } = require('../../nt-compat/src/registry');
const { tensorBytes } = require('../../nt-fusion/src/graph');

const COST_V = 1;
const DEFAULT_BPS = 25 * 1024 * 1024; // loopback mesuré §bench NT-Flux (hypothèse documentée)
const DEFAULT_CAST_BPS = 400 * 1024 * 1024; // calibré en test (cast mémoire→mémoire)

function flopsOf(registry, backend, learned) {
  if (learned && Number.isFinite(learned.flops) && learned.flops > 0) return learned.flops;
  const b = (registry.backends || {})[backend];
  return b && Number.isFinite(b.flops) && b.flops > 0 ? b.flops : 1e6;
}

function reliabilityOf(learned) {
  if (!learned || !Number.isInteger(learned.done)) return 0.5; // inconnu : neutre, pas confiant
  const total = learned.done + (learned.failed || 0);
  if (!total) return 0.5;
  return learned.done / total;
}

/**
 * Évalue un placement. learned = fiche nt-learn {flops, done, failed,
 * msEwma?} ou null. dataLocal = true si les entrées sont déjà sur le worker.
 */
function evalPlacement({ node, shape, worker, inputBytes = 0, learned = null, bps = null, reliabilityPenalty = true }) {
  const task = {
    id: `cost-${node.id}`, op: node.kind, dtype: node.dtype, backend: node.backend,
    tensors: [{ shape }],
  };
  const chk = checkAssignment(worker.registry, task);
  if (!chk.ok) return { ok: false, reason: chk.reason };
  if (node.backend && chk.backend !== node.backend) {
    return { ok: false, reason: `backend ${chk.backend} ≠ exigé ${node.backend}` };
  }
  const flops = node.flops || 0;
  const tCalc = (flops / flopsOf(worker.registry, chk.backend, learned)) * 1000;
  const debit = bps || worker.registry.netBpsTo || DEFAULT_BPS;
  const tTransfer = (inputBytes / debit) * 1000;
  const tConvert = node.needsCast ? (tensorBytes(shape, node.dtype) / DEFAULT_CAST_BPS) * 1000 : 0;
  const tCodec = node.fluxBytes ? (node.fluxBytes / debit) * 1000 : 0;
  const costMs = tCalc + tTransfer + tConvert + tCodec;
  const rel = reliabilityOf(learned);
  const risk = reliabilityPenalty ? (1 - rel) * 0.5 : 0; // pénalité ≤ +50 %
  // Incertitude : large sans mesures, resserrée avec l'expérience.
  const n = learned && Number.isInteger(learned.done) ? learned.done : 0;
  const uncertainty = n <= 0 ? 1 : 1 / (1 + Math.log1p(n));
  return {
    ok: true, costMs: costMs * (1 + risk), backend: chk.backend,
    parts: { tCalc, tTransfer, tConvert, tCodec, reliability: rel, riskMult: 1 + risk },
    uncertainty,
  };
}

module.exports = { COST_V, DEFAULT_BPS, DEFAULT_CAST_BPS, evalPlacement, reliabilityOf };

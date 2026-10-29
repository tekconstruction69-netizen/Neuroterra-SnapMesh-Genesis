'use strict';

/**
 * Travailleur d'opération SnapMesh (§4 Secure sandbox).
 *
 * Ce fichier est le SEUL code qui s'exécute dans le worker : il ne charge que
 * `./ops` (liste blanche, `node:crypto` uniquement). Aucun socket, aucun
 * fichier, aucun secret ne lui est transmis : seule la paire {op, args} déjà
 * validée côté forme par l'appelant transite par `workerData` (copie
 * structurée, pas de partage mémoire). Toute erreur est renvoyée, jamais
 * levée vers le parent.
 */

const { parentPort, workerData } = require('node:worker_threads');
const { runOp } = require('./ops');

try {
  const t0 = Date.now();
  const result = runOp(workerData.op, workerData.args);
  parentPort.postMessage({ ok: true, result, durationMs: Date.now() - t0 });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String((e && e.message) || e).slice(0, 500) });
}

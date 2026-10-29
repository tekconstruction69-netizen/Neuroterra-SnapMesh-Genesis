'use strict';

/**
 * File de tâches côté coordinateur : identifiants uniques, états,
 * expiration et réaffectation, contrôles stricts d'admission des résultats,
 * persistance minimale (reprise après arrêt du coordinateur).
 *
 * États tâche : pending -> dispatched -> collecting -> done | failed.
 * Affectation (executor) : assigned -> answered | timeout | dead.
 *
 * recordResult() n'accepte qu'un résultat SOLLICITÉ : expéditeur affecté,
 * affectation encore valide, op correspondante, résultat sérialisable et
 * borné, pas de doublon. Tout rejet laisse votes, charge et verdict
 * inchangés (le rejet est signalé par son code, sans effet de bord).
 */

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');

const TASK_STATES = ['pending', 'dispatched', 'collecting', 'done', 'failed'];
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_SETTLED_KEPT = 100;

class Task {
  constructor({ id, op, args, redundancy = 1, timeoutMs = 8000, coordinatorId, createdAt, attempts }) {
    if (!Number.isInteger(redundancy) || redundancy < 1 || redundancy > 5) {
      throw new Error(`redondance-invalide: ${redundancy} (1..5 exigés)`);
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
      throw new Error(`timeout-invalide: ${timeoutMs} (100..120000 ms exigés)`);
    }
    this.id = id || randomUUID();
    this.op = op;
    this.args = args;
    this.redundancy = redundancy;
    this.timeoutMs = timeoutMs;
    this.coordinatorId = coordinatorId;
    this.state = 'pending';
    this.assignments = new Map(); // executorId -> {state, timer, attempt}
    this.seenExecutors = new Set(); // tout exécutant déjà affecté (distingue périmé/jamais vu)
    this.results = new Map(); // executorId -> {result, durationMs, at}
    this.createdAt = createdAt || Date.now();
    this.settledAt = null;
    this.attempts = attempts || 0;
  }
}

function resultSerializable(result) {
  if (result === undefined) return false;
  try {
    const s = JSON.stringify(result);
    if (typeof s !== 'string') return false;
    if (Buffer.byteLength(s, 'utf8') > MAX_RESULT_BYTES) return 'oversize';
    // Relecture : refuse les valeurs non JSON (BigInt déjà exclu par stringify qui lève).
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

class TaskQueue {
  constructor({ maxAttempts = 6, persistPath = null } = {}) {
    this.tasks = new Map();
    this.maxAttempts = maxAttempts;
    this.persistPath = persistPath;
    this.onEvent = () => {};
  }

  submit({ op, args, redundancy, timeoutMs, coordinatorId }, validate) {
    if (typeof validate === 'function') validate(op, args); // rejette op inconnue / args invalides
    const t = new Task({ op, args, redundancy, timeoutMs, coordinatorId });
    this.tasks.set(t.id, t);
    this.onEvent({ kind: 'submitted', taskId: t.id, op });
    this._save();
    return t;
  }

  get(id) {
    return this.tasks.get(id) || null;
  }

  /** Marque une affectation ; programme son expiration. */
  assign(task, executorId, onTimeout) {
    task.attempts++;
    task.state = task.results.size ? 'collecting' : 'dispatched';
    const a = { state: 'assigned', attempt: task.attempts, startedAt: Date.now(), timer: null };
    a.timer = setTimeout(() => {
      if (a.state !== 'assigned') return;
      a.state = 'timeout';
      task.assignments.delete(executorId);
      this.onEvent({ kind: 'timeout', taskId: task.id, executorId });
      this._save();
      onTimeout(task, executorId);
    }, task.timeoutMs);
    if (a.timer.unref) a.timer.unref();
    task.assignments.set(executorId, a);
    task.seenExecutors.add(executorId);
    this.onEvent({ kind: 'assigned', taskId: task.id, executorId, attempt: a.attempt });
    this._save();
  }

  /**
   * Enregistre un résultat sollicité. Codes : accepted | settled |
   * duplicate | unsolicited | stale | wrong-op | bad-result | oversize.
   * Seul 'accepted' modifie la tâche.
   */
  recordResult(task, executorId, result, durationMs, { op } = {}) {
    if (task.state === 'done' || task.state === 'failed') return 'settled';
    if (task.results.has(executorId)) return 'duplicate';
    const a = task.assignments.get(executorId);
    if (!a) return task.seenExecutors.has(executorId) ? 'stale' : 'unsolicited';
    if (a.state !== 'assigned') return 'stale';
    if (op !== undefined && op !== task.op) return 'wrong-op';
    const ser = resultSerializable(result);
    if (ser === 'oversize') return 'oversize';
    if (!ser) return 'bad-result';
    clearTimeout(a.timer);
    a.state = 'answered';
    task.results.set(executorId, { result, durationMs, at: Date.now() });
    if (task.state === 'dispatched') task.state = 'collecting';
    this.onEvent({ kind: 'result', taskId: task.id, executorId });
    this._save();
    return 'accepted';
  }

  settle(task, state) {
    task.state = state;
    task.settledAt = Date.now();
    for (const [, a] of task.assignments) clearTimeout(a.timer);
    this.onEvent({ kind: state, taskId: task.id });
    this._prune();
    this._save();
  }

  /** Réaffecte après panne d'un exécutant (dead/timeout). */
  executorFailed(task, executorId) {
    const a = task.assignments.get(executorId);
    if (a && a.state === 'assigned') {
      clearTimeout(a.timer);
      a.state = 'dead';
    }
    task.assignments.delete(executorId);
    return task.attempts < this.maxAttempts && task.state !== 'done' && task.state !== 'failed';
  }

  pending() {
    return [...this.tasks.values()].filter((t) => t.state === 'pending');
  }

  /** Mémoire bornée : ne garde que les N dernières tâches soldées. */
  _prune() {
    const settled = [...this.tasks.values()]
      .filter((t) => t.state === 'done' || t.state === 'failed')
      .sort((a, b) => (a.settledAt || 0) - (b.settledAt || 0));
    while (settled.length > MAX_SETTLED_KEPT) {
      const old = settled.shift();
      this.tasks.delete(old.id);
    }
  }

  // ---------- persistance minimale (reprise coordinateur) ----------

  /** Écriture robuste : fichier temporaire + renommage atomique. */
  _save() {
    if (!this.persistPath) return;
    try {
      const data = JSON.stringify(
        [...this.tasks.values()]
          .filter((t) => t.state !== 'done' && t.state !== 'failed')
          .map((t) => ({
            id: t.id,
            op: t.op,
            args: t.args,
            redundancy: t.redundancy,
            timeoutMs: t.timeoutMs,
            coordinatorId: t.coordinatorId,
            createdAt: t.createdAt,
            attempts: t.attempts,
            results: [...t.results.entries()].map(([executorId, r]) => [executorId, r]),
            seen: [...t.seenExecutors],
          }))
      );
      fs.writeFileSync(this.persistPath + '.tmp', data);
      fs.renameSync(this.persistPath + '.tmp', this.persistPath);
    } catch (err) {
      this.onEvent({ kind: 'persist-error', message: err.message });
    }
  }

  /** Recharge les tâches non soldées ; affectations reparties à zéro. */
  load() {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return [];
    const raw = JSON.parse(fs.readFileSync(this.persistPath, 'utf8'));
    const out = [];
    for (const s of raw) {
      const t = new Task(s);
      t.state = 'pending'; // reprise : tout est à re-dispatcher
      for (const [executorId, r] of s.results || []) t.results.set(executorId, r);
      for (const id of s.seen || []) t.seenExecutors.add(id);
      this.tasks.set(t.id, t);
      out.push(t);
    }
    return out;
  }
}

module.exports = { Task, TaskQueue, TASK_STATES, MAX_RESULT_BYTES, MAX_SETTLED_KEPT };

'use strict';

/**
 * Bac à sable d'exécution §4 : chaque tâche réseau s'exécute dans un
 * `worker_threads` dédié (isolat V8, aucun handle partagé), avec bornes
 * réelles : durée maximale (kill), tas maximal (resourceLimits), résultat
 * maximal (octets sérialisés), concurrence maximale (refus `sandbox-busy`),
 * annulation par run et arrêt global.
 *
 * Niveau d'isolation honnête : ce N'EST PAS un sandbox OS (même UID, pas de
 * seccomp/AppContainer/chroot ; `process.env` reste lisible — aucun secret
 * ne doit transiter). La menace couverte : arguments distants malveillants
 * ou excessifs contre du code 100 % local (liste blanche `ops.js`).
 * Voir `docs/SANDBOX.md` pour le modèle de menace complet.
 */

const { Worker } = require('node:worker_threads');
const path = require('node:path');

const WORKER_FILE = path.join(__dirname, 'op-worker.js');

class SandboxError extends Error {
  constructor(code, detail) {
    super(`sandbox-${detail ? `${code}: ${detail}` : code}`);
    this.code = `sandbox-${code}`;
  }
}

class Sandbox {
  constructor({ maxWorkers = 2, execTimeoutMs = 5000, memMb = 64, maxResultBytes = 1024 * 1024 } = {}) {
    this.maxWorkers = Math.max(1, Math.floor(maxWorkers));
    this.execTimeoutMs = execTimeoutMs;
    this.memMb = memMb;
    this.maxResultBytes = maxResultBytes;
    this.active = new Map(); // id -> { worker, timer, reject }
    this.nextId = 1;
    this.counters = { started: 0, done: 0, timeout: 0, busy: 0, crashed: 0, cancelled: 0, refused: 0 };
  }

  describe() {
    return {
      maxWorkers: this.maxWorkers,
      execTimeoutMs: this.execTimeoutMs,
      memMb: this.memMb,
      maxResultBytes: this.maxResultBytes,
      backend: 'worker_threads',
      osSandbox: false, // honnête : pas d'isolation au niveau OS
    };
  }

  stats() {
    return { ...this.counters, active: this.active.size };
  }

  /** Test uniquement : accès aux workers en vol (simulation de crash). */
  _activeWorkers() {
    return [...this.active.values()].map((e) => e.worker);
  }

  run(op, args) {
    if (this.active.size >= this.maxWorkers) {
      this.counters.busy++;
      return Object.assign(
        Promise.reject(new SandboxError('busy', `${this.active.size}/${this.maxWorkers}`)),
        { cancel: () => false }
      );
    }
    const id = this.nextId++;
    let worker;
    try {
      worker = new Worker(WORKER_FILE, {
        workerData: { op, args },
        resourceLimits: { maxOldGenerationSizeMb: this.memMb },
      });
    } catch (e) {
      this.counters.refused++;
      return Object.assign(Promise.reject(new SandboxError('spawn', String((e && e.message) || e).slice(0, 200))), {
        cancel: () => false,
      });
    }
    this.counters.started++;
    let entry;
    const promise = new Promise((resolve, reject) => {
      entry = { worker, timer: null, reject, settled: false };
      this.active.set(id, entry);
      const settle = (fn) => (v) => {
        if (entry.settled) return;
        entry.settled = true;
        clearTimeout(entry.timer);
        this.active.delete(id);
        worker.terminate().catch(() => {});
        fn(v);
      };
      entry.timer = setTimeout(() => {
        this.counters.timeout++;
        settle(reject)(new SandboxError('timeout', `${this.execTimeoutMs} ms`));
      }, this.execTimeoutMs);
      // Le minuteur ne retient pas le processus à la sortie des tests.
      if (entry.timer.unref) entry.timer.unref();
      worker.once('message', (m) => {
        if (!m || typeof m !== 'object') {
          this.counters.crashed++;
          settle(reject)(new SandboxError('crash', 'message invalide'));
          return;
        }
        if (!m.ok) {
          // Op inconnue / args invalides : refusé, comme en exécution directe.
          this.counters.refused++;
          settle(reject)(new Error(m.error || 'op refusée'));
          return;
        }
        let size = -1;
        try {
          size = Buffer.byteLength(JSON.stringify(m.result), 'utf8');
        } catch {
          this.counters.refused++;
          settle(reject)(new SandboxError('bad-result', 'non sérialisable'));
          return;
        }
        if (size > this.maxResultBytes) {
          this.counters.refused++;
          settle(reject)(new SandboxError('result-too-large', `${size} > ${this.maxResultBytes} octets`));
          return;
        }
        this.counters.done++;
        settle(resolve)({ result: m.result, durationMs: m.durationMs });
      });
      const onCrash = (kind) => () => {
        this.counters.crashed++;
        settle(reject)(new SandboxError('crash', kind));
      };
      worker.once('error', onCrash('worker-error'));
      // Toute sortie SANS message préalable est anormale par construction
      // (le succès poste toujours un message avant de se terminer ; le
      // settle() ultérieur est sans effet car entry.settled est posé).
      worker.once('exit', (code) => onCrash(`exit-${code}`)());
    });
    const cancel = () => {
      if (entry.settled) return false;
      this.counters.cancelled++;
      entry.settled = true;
      clearTimeout(entry.timer);
      this.active.delete(id);
      worker.terminate().catch(() => {});
      entry.reject(new SandboxError('cancelled', 'annulé'));
      return true;
    };
    return Object.assign(promise, { cancel });
  }

  /** Arrêt global : tue tout, rejette l'en-cours (`sandbox-shutdown`). */
  async shutdown() {
    const err = new SandboxError('shutdown', 'arrêt du bac à sable');
    for (const [, e] of this.active) {
      if (e.settled) continue;
      e.settled = true;
      clearTimeout(e.timer);
      e.reject(err);
    }
    this.active.clear();
  }
}

module.exports = { Sandbox, SandboxError };

'use strict';

/**
 * Ordonnanceurs déterministes interchangeables — même interface, pour que
 * la comparaison future (locale / round-robin / capacités / Muse) soit
 * équitable (voir docs/MUSE_CONTRACTS.md).
 *
 * pick(task, candidates, state) -> id du nœud choisi.
 * - candidates : [{id, cpus, load}] (load = tâches actives, 0 si inconnu).
 * - state : objet persistant entre appels (compteur round-robin…).
 * Tous déterministes à (task, candidates, state) identiques.
 */

function byId(a, b) {
  return a.id < b.id ? -1 : 1;
}

const schedulers = {
  /** Référence B1 : rotation stricte, ignore les capacités. */
  'round-robin': {
    describe: 'Rotation stricte sur les candidats triés par id.',
    pick(task, candidates, state) {
      const sorted = candidates.slice().sort(byId);
      if (!sorted.length) return null;
      state.n = (state.n || 0) + 1;
      return sorted[(state.n - 1) % sorted.length].id;
    },
  },

  /** Tient compte des capacités : plus de CPU et moins de charge d'abord. */
  capacity: {
    describe: 'Score = cpus / (1 + load), égalité tranchée par id.',
    pick(task, candidates, state) {
      void state;
      void task;
      const sorted = candidates
        .map((c) => ({ id: c.id, score: (c.cpus || 1) / (1 + (c.load || 0)) }))
        .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
      return sorted.length ? sorted[0].id : null;
    },
  },

  /**
   * Muse-planifié (§6) : proposition heuristique (déterministe, sans réseau)
   * validée par l'arbitre avant usage ; tout refus bascule sur round-robin.
   * L'appel distant réel passe par `musePropose` (clé/URL explicites) et
   * aboutit ici après validation identique. `state.lastPlan` expose le plan.
   */
  muse: {
    describe: 'Heuristique validée par l\u2019arbitre, repli round-robin.',
    pick(task, candidates, state) {
      const { buildPlacementInput, heuristicPropose, validateProposal } = require('./muse');
      const redundancy = task.redundancy || 1;
      const input = buildPlacementInput({
        nodes: candidates,
        queue: [{ taskId: task.id, op: task.op, args: task.args || {}, redundancy, timeoutMs: task.timeoutMs || 8000 }],
        history: task.history || [],
        budgets: task.budgets,
      });
      const proposal = heuristicPropose(input, { redundancy });
      // Mode synchrone (un pick par dispatch) : on exige des exécutants
      // connus dans 1..5, pas le compte exact (les dispatches suivants
      // consomment la suite du classement). Le compte exact est contrôlé
      // sur le chemin async (musePropose, assignment réellement utilisée).
      const verdict = validateProposal(proposal, {
        taskIds: new Set([task.id]),
        connectedIds: new Set(candidates.map((c) => c.id)),
        redundancy: null,
        provider: 'heuristic',
      });
      if (verdict.ok && proposal.assignments[0] && proposal.assignments[0].executors.length) {
        const pool = new Set(candidates.map((c) => c.id));
        const first = proposal.assignments[0].executors.find((id) => pool.has(id));
        if (first) {
          state.lastPlan = { provider: 'heuristic', explanation: proposal.explanation, confidence: proposal.confidence, fallbackUsed: false, reason: null };
          return first;
        }
      }
      const reason = (verdict.ok ? 'exécutant proposé hors candidats' : verdict.reason) || 'plan invalide';
      state.lastPlan = { provider: 'heuristic', explanation: null, confidence: null, fallbackUsed: true, reason };
      return schedulers['round-robin'].pick(task, candidates, state);
    },
  },

  /** Référence B0 : exécute sur le coordinateur lui-même quand possible. */
  local: {
    describe: 'Coordinateur d\'abord, sinon premier candidat par id.',
    pick(task, candidates, state) {
      void state;
      const sorted = candidates.slice().sort(byId);
      if (!sorted.length) return null;
      return sorted.some((c) => c.id === task.coordinatorId) ? task.coordinatorId : sorted[0].id;
    },
  },
};

function listSchedulers() {
  return Object.fromEntries(Object.entries(schedulers).map(([k, v]) => [k, v.describe]));
}

module.exports = { schedulers, listSchedulers };

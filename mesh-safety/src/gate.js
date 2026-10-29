'use strict';

/**
 * SafetyGate : branche le contrôleur sur le moteur M2. Toute exécution
 * pour un pair et toute soumission coordinateur passent par requestBudget() :
 * un ordonnanceur (y compris Muse futur) ne peut pas contourner STOP,
 * la thermique ni les budgets — le refus est technique, pas déclaratif.
 */

class SafetyGate {
  constructor(controller) {
    this.controller = controller;
  }

  /** Exécutant : accepte-t-on cette TASK maintenant ? */
  admitRemote(op, estMemBytes = 0, telemetry) {
    return this.controller.requestBudget({ tasks: 1, estMemBytes }, telemetry);
  }

  /** Coordinateur : peut-on soumettre ? */
  admitLocal(tasks = 1, telemetry) {
    return this.controller.requestBudget({ tasks }, telemetry);
  }

  track(id, label) {
    return this.controller.track(id, label);
  }

  untrack(id) {
    this.controller.untrack(id);
  }
}

module.exports = { SafetyGate };

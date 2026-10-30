'use strict';

/**
 * SafetyController : budgets et vie du contributeur local.
 * États UI : STOPPED(arreté) STARTING(démarrage) ACTIVE(actif)
 * THERMAL_LIMIT(limitation thermique) SUSPENDED(suspendu) ERROR(erreur).
 * STOP est prioritaire : aucun ordonnanceur (ni Muse futur) ne peut
 * contribuer quand le contrôleur n'est pas ACTIVE/THERMAL_LIMIT, car toute
 * admission passe par requestBudget().
 * Les % cibles sont des objectifs de service coopératifs (concurrence +
 * découpage temporel), PAS des plafonnements matériels.
 */

const { ThermalMachine } = require('./thermal');

const MODES = {
  eco: { label: 'Éco', cpuTarget: 0.01, workers: 1, concurrent: 1 },
  balanced: { label: 'Équilibré', cpuTarget: 0.05, workers: 2, concurrent: 2 },
  performance: { label: 'Performance', cpuTarget: 0.1, workers: 4, concurrent: 4 },
};

const STATES = ['STOPPED', 'STARTING', 'ACTIVE', 'THERMAL_LIMIT', 'SUSPENDED', 'ERROR'];

class SafetyController {
  constructor({ mode = 'balanced', deviceClass = 'desktop-windows', maxMemRatio = 0.8, dutyWindowMs = 1000 } = {}) {
    if (!MODES[mode]) throw new Error(`mode-inconnu: ${mode}`);
    this.mode = mode;
    this.targets = { ...MODES[mode] }; // cibles modifiables (1/5/10 % par défaut)
    this.deviceClass = deviceClass;
    this.maxMemRatio = maxMemRatio;
    this.dutyWindowMs = dutyWindowMs;
    this.state = 'STOPPED';
    this.stateReason = 'arrêté par l utilisateur';
    this.thermal = new ThermalMachine(deviceClass);
    this.tasks = new Map(); // id -> {abort, startedAt, label}
    this.lastCpu = null;
    this.measuredCpu = 0; // % machine mesuré (affichage, pas une garantie)
    this.events = [];
    this.consent = false;
    this.meshSuspended = false;
  }

  /**
   * Réglages utilisateur : refus strict de toute valeur invalide.
   * Règles : cpuTarget ∈ ]0, 0.50] fini ; workers/concurrent entiers
   * finis dans [1, 64] ; champs fournis valant undefined/null/NaN/
   * Infinity/chaîne/booléen/objet rejetés ; clés inconnues rejetées ;
   * aucun réglage ne dépasse les plafonds (CPU ≤ 50 %, jamais 0).
   */
  setTargets(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('cibles-invalides: objet requis');
    }
    const allowed = new Set(['cpuTarget', 'workers', 'concurrent']);
    for (const k of Object.keys(input)) {
      if (!allowed.has(k)) throw new Error(`cible-inconnue: ${k}`);
    }
    const finiteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
    const out = {};
    if ('cpuTarget' in input) {
      const v = input.cpuTarget;
      if (!finiteNumber(v) || v <= 0 || v > 0.5) throw new Error('cible-cpu-invalide (0 exclu..50 % max, fini requis)');
      out.cpuTarget = v;
    }
    for (const k of ['workers', 'concurrent']) {
      if (k in input) {
        const v = input[k];
        if (!finiteNumber(v) || !Number.isInteger(v) || v < 1 || v > 64) {
          throw new Error(`cible-${k}-invalide (entier fini 1..64 requis)`);
        }
        out[k] = v;
      }
    }
    Object.assign(this.targets, out);
  }

  /** START : consentement explicite + préconditions vérifiées. */
  start({ consent = false } = {}, telemetry) {
    if (!consent) return this._fail('consentement requis');
    this.consent = true;
    if (this.thermal.state === 'EMERGENCY_STOP') return this._fail('arrêt thermique verrouillé : reset requis');
    if (telemetry) {
      const b = telemetry.battery;
      if (b && b.available && b.low === true && b.charging !== true) {
        return this._fail('batterie faible : contribution refusée');
      }
      if (telemetry.memRatio >= this.maxMemRatio) return this._fail('mémoire système saturée');
    }
    this._set('STARTING', 'vérifications ok');
    this._set('ACTIVE', 'contribution autorisée');
    return this.status();
  }

  /** STOP : prioritaire, annule tout, confirme les libérations. */
  async stop(reason = 'arrêt demandé') {
    const ids = [...this.tasks.keys()];
    for (const [, t] of this.tasks) {
      try { t.abort.abort(); } catch {}
    }
    const deadline = Date.now() + 3000;
    while (this.tasks.size && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const pending = [...this.tasks.keys()];
    this.tasks.clear();
    this.meshSuspended = false; // STOP manuel : aucune reprise auto
    this._set('STOPPED', reason);
    return { stopped: true, cancelled: ids, pending, confirmed: pending.length === 0 };
  }

  /** Porte d'admission : tout travail (Muse futur inclus) passe ici. */
  requestBudget({ tasks = 1, estMemBytes = 0 } = {}, telemetry) {
    if (this.state !== 'ACTIVE' && this.state !== 'THERMAL_LIMIT') {
      return { granted: false, reason: `état ${this.state} : contribution interdite` };
    }
    const running = this.tasks.size;
    const maxConc = this.state === 'THERMAL_LIMIT' ? 1 : this.targets.concurrent;
    if (running + tasks > maxConc) return { granted: false, reason: 'concurrence maximale atteinte' };
    if (telemetry && telemetry.memRatio >= this.maxMemRatio) {
      return { granted: false, reason: 'mémoire système saturée' };
    }
    void estMemBytes;
    return { granted: true, duty: this._duty() };
  }

  /** Enregistre une tâche admise (avec signal d'annulation). */
  track(id, label = '') {
    const abort = new AbortController();
    this.tasks.set(id, { abort, startedAt: Date.now(), label });
    return abort.signal;
  }

  untrack(id) {
    this.tasks.delete(id);
  }

  /**
   * État de travail dérivé (9 états produit) depuis l'état safety réel.
   * Un worker seul n'est PAS en panne : WAITING_FOR_PEERS. SUSPENDED ne
   * devient CONNECTION_LOST que si un pair a déjà été vu (perte réelle) ;
   * les pauses de protection restent PAUSED_SAFETY.
   */
  deriveWorkerState({ peers = 0, everHadPeers = false } = {}) {
    if (this.state === 'STOPPED') return 'STOPPED';
    if (this.state === 'ERROR') return 'ERROR';
    if (this.state === 'STARTING') return 'ANALYZING';
    if (this.state === 'THERMAL_LIMIT') return this.tasks.size ? 'RUNNING' : 'PAUSED_SAFETY';
    if (this.state === 'SUSPENDED') {
      return /thermique|batterie|mémoire/.test(this.stateReason) ? 'PAUSED_SAFETY' : 'CONNECTION_LOST';
    }
    // ACTIVE
    if (this.tasks.size > 0) return 'RUNNING';
    void everHadPeers;
    return peers > 0 ? 'WAITING_FOR_TASKS' : 'WAITING_FOR_PEERS';
  }

  /** Réseau maillé perdu : suspend sans arrêter (STOP reste distinct). */
  onMeshLost() {
    if (this.state !== 'ACTIVE' && this.state !== 'THERMAL_LIMIT') return this.status();
    this.meshSuspended = true;
    this._set('SUSPENDED', 'réseau maillé perdu : en attente de pairs');
    this._shedAll('réseau perdu');
    return this.status();
  }

  /** Réseau revenu : reprend si c'est le réseau qui avait suspendu. */
  onMeshBack() {
    if (!this.meshSuspended) return this.status();
    if (this.state === 'SUSPENDED') {
      this.meshSuspended = false;
      this._set('ACTIVE', 'réseau maillé retrouvé : reprise');
    }
    return this.status();
  }

  /** Tick périodique : thermique + mémoire + mesure CPU réelle. */
  tick(telemetry) {
    if (telemetry) {
      if (this.lastCpu) {
        const dt = Math.max(1, telemetry.at - this.lastCpu.at);
        const dcpu = telemetry.procCpuMicros - this.lastCpu.cpu;
        this.measuredCpu = dcpu / (dt * 1000 * telemetry.cpus);
      }
      this.lastCpu = { at: telemetry.at, cpu: telemetry.procCpuMicros };
      const th = this.thermal.evaluate(telemetry);
      if (th === 'EMERGENCY_STOP') {
        this._emergency(telemetry);
      } else if (th === 'PAUSED' && this.state !== 'STOPPED' && this.state !== 'ERROR') {
        this._set('SUSPENDED', 'pause thermique : workers interrompus');
        this._shedAll('pause thermique');
      } else if (th === 'THROTTLED' && this.state === 'ACTIVE') {
        this._set('THERMAL_LIMIT', 'limitation thermique : service réduit');
      } else if (th === 'NORMAL' && this.state === 'THERMAL_LIMIT') {
        this._set('ACTIVE', 'retour conditions normales');
      }
      const b = telemetry.battery;
      if (b && b.available && b.low === true && b.charging !== true && this.state === 'ACTIVE') {
        this._set('SUSPENDED', 'batterie faible');
        this._shedAll('batterie faible');
      }
      if (telemetry.memRatio >= this.maxMemRatio && (this.state === 'ACTIVE' || this.state === 'THERMAL_LIMIT')) {
        this._set('SUSPENDED', 'mémoire saturée');
        this._shedAll('mémoire saturée');
      }
    }
    return this.status();
  }

  /** Fenêtre de service du découpage temporel (coopératif). */
  _duty() {
    const target = this.state === 'THERMAL_LIMIT' ? this.targets.cpuTarget / 2 : this.targets.cpuTarget;
    return { windowMs: this.dutyWindowMs, runMs: Math.max(10, Math.round(this.dutyWindowMs * target)) };
  }

  _shedAll(reason) {
    for (const [, t] of this.tasks) {
      try { t.abort.abort(); } catch {}
    }
    void reason;
  }

  _emergency(telemetry) {
    void telemetry;
    this._shedAll('urgence thermique');
    this.tasks.clear();
    this._set('ERROR', 'ARRÊT URGENCE thermique : reset explicite requis');
  }

  /** Reset après urgence : conditions sûres + geste explicite. */
  resetEmergency(telemetry) {
    const s = this.thermal.reset(telemetry);
    if (s === 'NORMAL') {
      this._set('STOPPED', 'urgence levée : START requis pour reprendre');
      return true;
    }
    return false;
  }

  _set(state, reason) {
    this.state = state;
    this.stateReason = reason;
    this.events.push({ state, reason, at: Date.now() });
    if (this.events.length > 200) this.events.shift();
  }

  _fail(reason) {
    this._set('ERROR', reason);
    return this.status();
  }

  status() {
    return {
      state: this.state,
      reason: this.stateReason,
      mode: this.mode,
      targets: { ...this.targets },
      thermal: this.thermal.state,
      measuredCpu: this.measuredCpu,
      activeTasks: this.tasks.size,
      meshSuspended: this.meshSuspended,
      duty: this._duty(),
    };
  }
}

module.exports = { SafetyController, MODES, STATES };

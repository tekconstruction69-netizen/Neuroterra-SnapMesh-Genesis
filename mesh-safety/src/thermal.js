'use strict';

/**
 * Machine thermique : NORMAL -> THROTTLED -> PAUSED -> EMERGENCY_STOP.
 * Seuils par classe d'appareil (pas universels). Sources, par priorité :
 * 1. température injectée/mesurée quand `thermal.available` (jamais inventée) ;
 * 2. signaux proxy observables (mémoire saturée durable) ;
 * 3. défaut conservateur : sans télémétrie, on ne dégrade jamais sur une
 *    température imaginaire, mais on plafonne l'ambition (mode Éco forcé).
 * EMERGENCY_STOP est verrouillé : reprise = conditions sûres + reset explicite.
 */

const STATES = ['NORMAL', 'THROTTLED', 'PAUSED', 'EMERGENCY_STOP'];

const DEVICE_CLASSES = {
  // Seuils issus de plages constructeurs usuelles (documentation, pas mesure).
  'desktop-windows': { warnC: 80, criticalC: 95, memPause: 0.92, memThrottle: 0.85 },
  'laptop-windows': { warnC: 75, criticalC: 90, memPause: 0.9, memThrottle: 0.82 },
  'android-generic': { warnC: 42, criticalC: 48, memPause: 0.88, memThrottle: 0.8 },
  'ios-generic': { warnC: 42, criticalC: 47, memPause: 0.88, memThrottle: 0.8 },
};

class ThermalMachine {
  constructor(deviceClass = 'desktop-windows') {
    if (!DEVICE_CLASSES[deviceClass]) throw new Error(`classe-inconnue: ${deviceClass}`);
    this.deviceClass = deviceClass;
    this.cfg = DEVICE_CLASSES[deviceClass];
    this.state = 'NORMAL';
    this.latched = false;
    this.history = [];
  }

  /** Évalue une télémétrie (réelle ou injectée) ; retourne l'état. */
  evaluate(t) {
    const temp = t.thermal && t.thermal.available ? t.thermal.celsius : null;
    let next = 'NORMAL';
    if (temp !== null) {
      if (temp >= this.cfg.criticalC) next = 'EMERGENCY_STOP';
      else if (temp >= this.cfg.warnC + 10) next = 'PAUSED';
      else if (temp >= this.cfg.warnC) next = 'THROTTLED';
    } else {
      // Proxy observables uniquement (jamais de température inventée).
      if (t.memRatio >= this.cfg.memPause) next = 'PAUSED';
      else if (t.memRatio >= this.cfg.memThrottle) next = 'THROTTLED';
    }
    // Signal thermique sévère explicite (ex. Android) : arrêt immédiat.
    if (t.thermal && t.thermal.severe === true) next = 'EMERGENCY_STOP';
    return this._go(next, temp === null ? 'proxy-ou-défaut' : `temp=${temp}C`);
  }

  _go(next, why) {
    const order = { NORMAL: 0, THROTTLED: 1, PAUSED: 2, EMERGENCY_STOP: 3 };
    if (this.latched && next !== 'EMERGENCY_STOP') {
      // Verrouillé : seule une amélioration + reset déverrouille (voir reset()).
      if (order[next] < order[this.state]) {
        this.history.push({ from: this.state, held: next, at: Date.now(), why });
      }
      return this.state;
    }
    if (next !== this.state) {
      this.history.push({ from: this.state, to: next, at: Date.now(), why });
      this.state = next;
      if (next === 'EMERGENCY_STOP') this.latched = true;
    }
    return this.state;
  }

  /** Reprise après EMERGENCY_STOP : conditions sûres + geste explicite. */
  reset(t) {
    if (this.state !== 'EMERGENCY_STOP') return this.state;
    const temp = t && t.thermal && t.thermal.available ? t.thermal.celsius : null;
    const cool = temp === null ? (t ? t.memRatio < this.cfg.memThrottle : false) : temp < this.cfg.warnC;
    if (!cool) return this.state;
    this.latched = false;
    this.history.push({ from: 'EMERGENCY_STOP', to: 'NORMAL', at: Date.now(), why: 'reset-explicite' });
    this.state = 'NORMAL';
    return this.state;
  }
}

module.exports = { ThermalMachine, STATES, DEVICE_CLASSES };

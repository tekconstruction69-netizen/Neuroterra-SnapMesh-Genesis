'use strict';

/**
 * Matrice de compatibilité honnête : ce que chaque plateforme PERMET
 * réellement. Ne jamais promettre ailleurs ce qui n'est permis qu'ici.
 * - Windows natif (Node) : mesuré et appliqué (boucle M2-SAFETY).
 * - Android/iOS natifs : NON implémentés — exigences notées, rien d'affirmé.
 * - Web/PWA : ce que les API navigateur exposent vraiment.
 */

const MATRIX = {
  'windows-node': {
    cpuCount: 'mesuré (os.cpus)',
    cpuCap: 'coopératif (concurrence + découpage temporel), PAS de plafonnement matériel',
    memory: 'mesuré (RSS) + garde-fou avec délestage',
    workersBg: 'oui (processus/threads, pas de vraie fond de tâche OS)',
    battery: 'non mesuré en Node — politique conservatrice si injectée',
    thermal: 'non fiable — politique conservatrice + protections natives OS',
    pwa: 'non applicable',
  },
  'android-native': {
    status: '[PRÉVU] non implémenté',
    needs: 'BatteryManager, PowerManager thermal (API 29+), JobScheduler, limites par appareil',
  },
  'ios-native': {
    status: '[PRÉVU] non implémenté',
    needs: 'NSProcessInfo thermalState, BackgroundTasks, limites strictes Apple',
  },
  'web-pwa': {
    cpuCount: 'partiel (hardwareConcurrency ; pas de mesure temps réel)',
    cpuCap: 'non — aucun plafonnement CPU possible dans le navigateur',
    memory: 'partiel (deviceMemory Chrome uniquement, approximatif)',
    workersBg: 'non — pas de calcul en arrière-plan fiable (service worker non prévu pour)',
    battery: 'dépréciée/retirée (Battery Status API) — ne pas promettre',
    thermal: 'non exposée — ne pas promettre',
    installable: 'si contexte sécurisé (https ou localhost) + manifest + SW',
  },
};

function capability(platform, key) {
  const p = MATRIX[platform];
  if (!p) throw new Error(`plateforme-inconnue: ${platform}`);
  return p[key];
}

module.exports = { MATRIX, capability };

# M4 — Validation safety (mesures, pas d'affichage)

## 1. STOP réellement mesuré (P5)

Test `sandbox.test.js` : 2 runs fib40 (~50 ms), `shutdown()` à 5 ms →
**les deux rejetés, délai < 2 s** (vert). Le STOP applicatif
(`/api/stop` → `safety.stop()` + `sandbox.shutdown()`) utilise le même
chemin. L'exécutant distant STOPpé refuse les TASK (`exec-refused`,
sandbox intact — test P8 vert) ; le coordinateur réaffecte après
timeout (délai documenté).

## 2. Bornes appliquées (toutes testées)

Mémoire : tas worker 64 Mo, résultat 1 Mio, plafond registre (moitié
RAM libre), tenseurs ≤16 (4 Ko), enveloppes NT-Flux 2/4 Mio, historique
learner 500, journal 100. Concurrence : workers bornés + `sandbox-busy`.
Durée : timeouts par tâche/fragment (50 ms..120 s validés).

## 3. Thermique/batterie : conservateur, jamais inventé

Sondes indisponibles ici (WMI refusé sandbox) → proxy mémoire + Éco
forcé + disclaimer UI (« aucune sonde fiable : politique
conservatrice »). % affichés = objectifs coopératifs (note UI :
« pas des plafonds matériels. Aucun revenu promis. »). Plafonds CPU/GPU
effectifs (cgroups/Job Objects) : [PRÉVU] — l'UI ne les revendique pas.

## 4. Indépendance

Le contrôleur est consulté (frein) mais jamais piloté par NeuroCore
ni Muse : STOP prioritaire sur tout plan (tests frein placement,
exécution, Muse).

# Sécurité matérielle — contrôleur et protections (M2-SAFETY)

> Principe : **aucune valeur inventée, aucune simulation présentée comme
> protection validée**. Chaque capacité dit si elle est mesurée, injectée
> ([SIMULÉ]) ou indisponible, par plateforme (`mesh-safety/src/platforms.js`).

## 1. Resource Safety Controller (`mesh-safety/src/controller.js`)

Budgets par mode (cibles modifiables, défauts 1 % / 5 % / 10 %) :

| Mode | CPU cible | Workers | Tâches simultanées | Débit (tâches/10 s) |
|---|---|---|---|---|
| Éco | 1 % | 1 | 1 | 2 |
| Équilibré | 5 % | 2 | 2 | 10 |
| Performance | 10 % | 4 | 4 | 25 |

Mécanismes RÉELS : concurrence bornée, limiteur de débit d'admission,
garde mémoire (refus + délestage au-delà du ratio max), annulation par
`AbortController` avec confirmation, refus batterie faible / mémoire
saturée (quand mesurés). Les % sont des **objectifs coopératifs**
(concurrence + découpage temporel), jamais des plafonnements matériels.

## 2. Machine thermique (`thermal.js`)

`NORMAL → THROTTLED → PAUSED → EMERGENCY_STOP`, seuils par classe
d'appareil (`desktop-windows`, `laptop-windows`, `android-generic`,
`ios-generic`). Sources : température quand disponible (jamais inventée),
sinon signaux proxy (mémoire), sinon politique conservatrice.
`EMERGENCY_STOP` : attribution coupée, workers interrompus, ressources
libérées, **verrouillé jusqu'à conditions sûres + reset explicite**.

## 3. STOP prioritaire

`requestBudget()` est le seul passage : STOPPED/SUSPENDED/ERROR = refus
technique pour tout ordonnanceur, y compris Muse futur (`gate.js`,
`admit` dans le moteur M2, testé : TASK refusée quand STOPPED).
STOP annule, libère et confirme (liste des annulées + restantes).

## 4. Audit de capacités (Windows, 2026-10-26, vérifié)

Mesuré : 16 CPU, RAM totale/libre, CPU/RSS du processus, priorités,
workers. Indisponible : `loadavg` (zéros sur Windows), batterie et
thermique WMI (accès refusé ici) → politiques conservatrices.
Batterie/thermique natives Android/iOS : **[PRÉVU]**, rien d'affirmé.
Navigateur : pas de plafonnement CPU, pas d'arrière-plan fiable, pas de
thermique, batterie dépréciée (voir matrice).

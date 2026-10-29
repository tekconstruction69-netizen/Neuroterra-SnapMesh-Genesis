# Rapport de tests sécurité (M2-SAFETY) — 2026-10-26

> Chaque test dit s'il est **[SIMULÉ]** (télémétrie injectée) ou
> **[MATÉRIEL]** (mesuré sur ce PC : Ryzen 7 7435HS, 16 CPU, 15,7 Go).
> Versions : Node v24.14.0, Windows 10.0.26200.

## Résultats

| Test | Nature | Résultat |
|---|---|---|
| START sans consentement → ERROR | SIMULÉ | ✅ |
| START refuse batterie faible / mémoire saturée | SIMULÉ | ✅ |
| START puis STOP : annulation + confirmation | SIMULÉ | ✅ |
| Ordonnanceur refusé quand STOPPED | SIMULÉ | ✅ |
| Concurrence maximale (Éco = 1) | SIMULÉ | ✅ |
| Thermique warn → THROTTLED, critique → urgence verrouillée, reset à froid | SIMULÉ | ✅ |
| Pas de température inventée (stable sans sonde) | SIMULÉ | ✅ |
| Batterie faible / mémoire saturée en cours → SUSPENDED | SIMULÉ | ✅ |
| Cibles 1/5/10 %, bornes rejetées | SIMULÉ | ✅ |
| Matrice plateformes (web/PWA, Android/iOS) | revue | ✅ |
| Télémétrie réelle + indisponibles marqués | MATÉRIEL | ✅ |
| Duty 10 % : CPU mesuré < 35 % (borne du test) | MATÉRIEL | ✅ |
| Serveur : page FR, état STOPPED, consentement→ACTIVE, mode, STOP confirmé | MATÉRIEL (loopback) | ✅ 3/3 |
| Garde-fou : TASK refusée quand STOPPED | câblage réel, pair simulé | ✅ |

Suites : `mesh-safety` 15/15 (13 unit + 2 hardware) ; `mesh-app` 4/4 (API).
Journaux bruts : `bench-logs/safety-app-20261026.log`
(copie versionnable `validation-safety-20261026.log.txt`, sans secret).

## Couverture des 9 cas exigés

| # | Cas | Test | Nature |
|---|---|---|---|
| 1 | START / STOP | consentement, annulation confirmée, API | SIMULÉ + MATÉRIEL (API loopback) |
| 2 | Arrêt pendant une tâche | abort → libération → `confirmed` | SIMULÉ |
| 3 | Limitation CPU | concurrence bornée + duty mesuré < 35 % | SIMULÉ + MATÉRIEL |
| 4 | Mémoire saturée | refus START + SUSPENDED en cours | SIMULÉ |
| 5 | Batterie faible | refus START + SUSPENDED en cours | SIMULÉ |
| 6 | Signal thermique critique | urgence verrouillée, reset à froid seul | SIMULÉ |
| 7 | Mesures indisponibles | marquées, jamais inventées, état stable | SIMULÉ + MATÉRIEL |
| 8 | Déconnexion réseau | SUSPENDED + reprise (unit) ; kill pair réel → SUSPENDED → relance → ACTIVE (e2e) | SIMULÉ + MATÉRIEL (loopback) |
| 9 | Dépassement budget par l'ordonnanceur | refus STOPPED/concurrence/budgets ; TASK refusée STOPPED (garde-fou) | SIMULÉ + câblage réel |

## Non testé sur matériel (explicite)

Sondes thermiques et batterie réelles (inaccessibles ici), Android/iOS
natifs (non implémentés), arrière-plan PWA (non promis), plafonnement
CPU matériel (impossible en Node pur : objectif coopératif seul).

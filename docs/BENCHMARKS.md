# Benchmarks B0/B1/B2 (§10) — chiffres rapportés, sans conclusion de supériorité

> Protocole fixe : `fib(25)` × 4 tâches, redondance 1, 5 répétitions,
> pairs manuels loopback, harnais `scripts/bench-b0b1b2.js`.
> Journal brut horodaté : `bench-logs/bench-b0b1b2-2026-10-26T19-16-43-009Z.log`
> (JSONL : en-tête machine + 100 verdicts + résumés).
> Machine : Windows 11, Node.js v24.14.0 — voir l'en-tête du journal brut.

## Résultats (N=20 tâches par config, 5 reps)

| Config | Complétion | Makespan/tâche moy (σ) | Mur/rep moy (σ) |
|---|---|---|---|
| B0 local solo (référence temps) | 20/20 | 38,3 ms (3,9) | 4412 ms (18) |
| B1 round-robin 2 nœuds | 20/20 | 39,1 ms (3,6) | 4406 ms (10) |
| B2 local 2 nœuds (centralisé) | 20/20 | 37,5 ms (2,7) | 4404 ms (19) |
| capacity 2 nœuds | 20/20 | 37,8 ms (2,6) | 4414 ms (22) |
| muse 2 nœuds | 20/20 | 37,9 ms (3,0) | 4407 ms (8) |

## Lecture honnête (pas d'allégation)

- Complétion 100/100 partout : le système distribue et tranche dans les
  5 configurations, sans échec ni reprise.
- Les makespans (37–39 ms, σ 2,6–3,9) se recouvrent totalement : **aucune
  différence mesurable entre ordonnanceurs sur le même hôte**. Le coût
  observé (~38 ms pour un `fib(25)` de quelques microsecondes) est le plancher
  du chemin sandbox + transport local, identique pour tous.
- Le mur/rep (~4,4 s) est dominé par le délai de maillage fixe (4 s), pas
  par le calcul : il ne compare rien entre configs.
- O5 (bénéfice Muse) **non mesurable ici** : deux nœuds identiques sur la
  même machine ne discriminent aucun placement. La question reste ouverte
  pour du matériel hétérogène réel (LAN 2-PC : NON EXÉCUTÉ).
- Appels Muse distants : 0 (aucune clé configurée ; chemin repli prouvé
  par tests, jamais exercé en live).

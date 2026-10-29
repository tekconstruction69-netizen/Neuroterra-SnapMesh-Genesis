# NeuroCore — Benchmarks A–E

> Protocole : `node scripts/bench-neurocore.js --reps 5 --out
> bench-logs/neurocore-abcde-20261026.json`. Workload : mixed-fp32-int8
> n=16, exécutions réelles, 5/5 partout. Rapport JSON archivé.

## 1. Résultats (médianes /5, ce poste)

| Bras | Stratégie | Réussite | Temps méd. | + info |
|---|---|---|---|---|
| A | mono-appareil | 5/5 | 0,50 ms | 0 transfert |
| B | round-robin | 5/5 | 0,26 ms | transferts forcés |
| C | capacités | 5/5 | 0,16 ms | optimal statique ici |
| D | adaptatif sans apprentissage | 5/5 | 0,95 ms | surcharge ~0,9 ms |
| E | neurocore + apprentissage | 5/5 | 0,74 ms | surcharge ~0,5 ms, errPred bruitée |

Décisions invalides : 0. Récupération panne : OK (replan + reprise).
Falsifiés : couverts par quorum §7 réseau (M2 63/63), non rejoués ici.

## 2. Lecture honnête

- Temps sub-ms : écarts NON significatifs (bruit > effet). Aucune
  allégation « E plus rapide ». Ce qui est prouvé : mêmes verdicts
  exacts, 0 invalide, reprise OK, surcharge < 1 ms.
- E ne bat pas C ici (normal : workers équivalents, signal noyé).
  L'hypothèse (E rejoint puis dépasse C sur dérive/panne) est
  partiellement prouvée : dépassement sur panne (replan), pas sur
  makespan à chaud (bench asymétrique [PRÉVU]).
- Réel vs simulé : exécutions et coûts RÉELS (processus locaux) ;
  réseau SIMULÉ (fil/comptage, pas de sockets — sandbox) ; 2-PC,
  latence/bande passante variables, GPU asymétriques : NON EXÉCUTÉS.

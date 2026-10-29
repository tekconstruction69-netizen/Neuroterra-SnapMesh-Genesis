---
name: benchmark-lab
description: Produire des mesures honnêtes et rejouables (protocole, baselines B0/B1/B2, journaux bruts).
---

# Benchmark Lab

Rend chaque chiffre du projet crédible : protocole fixe, baselines
obligatoires, journaux bruts versionnés.

## Activation

Activer quand la tâche touche : `mesh-bench`, une métrique (makespan,
complétion, surcoût quorum, reprise), une comparaison contre baseline, ou
tout chiffre destiné à la démo ou au dossier.

## Workflow

1. Figer le protocole : matériel réel, charge, répétitions (≥ 5), seed.
2. Mesurer les baselines B0 (mono-nœud), B1 (round-robin), B2 (centralisé
   simulé) avant toute comparaison.
3. Publier moyenne + écart-type + N, avec lien vers le journal brut.
4. Si une mesure contredit l'hypothèse (ex. O5), le consigner et appliquer
   le repli prévu au lieu de chercher un chiffre favorable.

## Vérifications obligatoires

- Zéro mesure inventée ; matériel émulé étiqueté « émulé ».
- Chaque chiffre publié pointe vers protocole + matériel + journal brut.
- Gate M4 : suite complète rejouée avec journaux.

## Livrables attendus

Protocole, journaux bruts, tableau de résultats avec incertitudes, note au
`docs/JOURNAL.md`.

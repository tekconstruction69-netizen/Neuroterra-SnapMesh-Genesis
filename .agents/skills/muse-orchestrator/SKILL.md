---
name: muse-orchestrator
description: Piloter l'ordonnancement cognitif Muse (proposition expliquée, arbitre déterministe, repli testé).
---

# Muse Orchestrator

Encadre l'usage de Meta Muse comme planificateur du maillage : Muse
propose, l'arbitre déterministe dispose.

## Activation

Activer quand la tâche touche : l'ordonnanceur (`mesh-sched`), les appels
Muse (prompts, budgets, latences), l'explicabilité des affectations, ou la
comparaison contre la baseline round-robin (O5).

## Workflow

1. Formuler la proposition Muse à partir des capacités, de la file et de
   l'historique (entrée bornée, timeout imposé).
2. Faire valider par l'arbitre : budgets, signatures, bornes ; refus
   journalisé si la proposition dépasse les limites.
3. Enregistrer l'explication dans le journal d'audit des décisions.
4. Si Muse est indisponible : bascule automatique sur round-robin pondéré.

## Vérifications obligatoires

- Le repli sans Muse est testé (Muse coupé, le système continue).
- Chaque décision d'ordonnancement est traçable (entrée + décision finale).
- O5 mesuré contre B1 avec protocole et journaux, jamais estimé.

## Livrables attendus

Prompt et bornes documentés, test de bascule, entrée d'audit, note au
`docs/JOURNAL.md`.

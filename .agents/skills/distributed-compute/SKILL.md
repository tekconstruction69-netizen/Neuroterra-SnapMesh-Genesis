---
name: distributed-compute
description: Exécuter des tâches IA distribuées et idempotentes sur nœuds hétérogènes (sandbox, budgets, reprise).
---

# Distributed Compute

Couvre le cycle de vie des tâches : découpage, affectation, exécution
sandboxée, reprise sur panne.

## Activation

Activer quand la tâche touche : `mesh-exec`, `mesh-caps`, les descripteurs
de capacités, les quotas de ressources, ou la reprise après panne de nœud.

## Workflow

1. Vérifier que la tâche déclare besoins (RAM, GPU, temps max) et fonction
   de vérification.
2. Exécuter en sandbox : quotas CPU/RAM/temps, pas de réseau sortant.
3. Garantir l'idempotence (rejouable sans effet de bord) pour permettre la
   ré-affectation des tâches orphelines.
4. Tester la panne : kill d'un nœud → ré-affectation → complétion.

## Vérifications obligatoires

- L'ordonnanceur ne dépasse jamais le budget déclaré d'un nœud.
- Gate M1/M2 : complétion ≥ 95 % avec 25 % de churn injecté.
- Aucun appareil fictif dans les rapports.

## Livrables attendus

Tâche documentée (besoins + vérification), test chaos, mesures brutes,
note au `docs/JOURNAL.md`.

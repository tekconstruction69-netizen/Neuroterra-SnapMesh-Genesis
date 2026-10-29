---
name: security-verification
description: Garantir identité cryptographique, quorum de validation, confidentialité et sandbox de SnapMesh.
---

# Security Verification

Sécurise le maillage et prouve que chaque résultat est vérifiable.

## Activation

Activer quand la tâche touche : `mesh-identity`, `mesh-verify`, signatures,
mTLS, chiffrement des charges utiles, sandbox, budgets, ou l'exclusion d'un
nœud fautif.

## Workflow

1. Identité : clés Ed25519, empreinte = identifiant, messages signés.
2. Validation : quorum 2/3, comparaison de hachages ; désaccord →
   ré-exécution sur nœud de confiance puis exclusion.
3. Confidentialité : chiffrement X25519 éphémère, option « nœuds de
   confiance uniquement ».
4. Tester le nœud menteur : résultat falsifié → doit être détecté et exclu.

## Vérifications obligatoires

- 100 % des résultats acceptés sont signés avec quorum atteint.
- Aucune clé API ni secret dans le dépôt (variables d'environnement).
- Gate M2 : test du nœud menteur réussi.

## Livrables attendus

Preuve affichable (chaîne signature → quorum), test d'exclusion, audit des
secrets, note au `docs/JOURNAL.md`.

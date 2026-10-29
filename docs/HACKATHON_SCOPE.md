# Neuroterra SnapMesh Genesis — Périmètre hackathon

> Ce document sépare le **dû** (soumission) du **souhaité** (recherche).
> En cas de doute, on coupe dans le souhaité.

## Dans le périmètre (dû)

- Maillage local IP : 3+ nœuds, découverte, heartbeat, exécution (M1–M2).
- Quorum de validation 2/3 avec preuve affichable (M2).
- Ordonnanceur Muse + repli déterministe testé (M3).
- Sécurité minimale : signatures, mTLS, sandbox, budgets (M4).
- Benchmarks B0/B1/B2 avec journaux bruts (M4).
- Démo 3 minutes rejouable + dossier de soumission (M5).
- Traçabilité : journal du travail (`docs/JOURNAL.md`), pas de publication
  GitHub avant approbation.

## Hors périmètre (recherche, après le hackathon)

Wi-Fi Aware productif, DHT global complet, consensus byzantin, GPU
multi-fabricants optimisé, fédération multi-organisations, tokenomics,
applications mobiles natives.

## Critères d'arbitrage en cas de retard

1. Protéger la démo (M5) : un quorum simple qui tourne vaut mieux qu'un
   protocole parfait qui ne tourne pas.
2. Couper l'overlay global avant le local, le multi-sauts avant le quorum,
   l'optimisation GPU avant l'ordonnanceur.
3. Toute fonctionnalité coupée est documentée comme **[PRÉVU]** ou
   **[RECHERCHE]**, jamais présentée comme fonctionnelle.

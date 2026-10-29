# Neuroterra SnapMesh Genesis — Stratégie de test

> Règle d'or : **on ne déclare pas une fonctionnalité comme fonctionnelle
> sans l'avoir testée ; on n'invente aucune mesure ni aucun appareil.**

## 1. Pyramide de tests

1. **Unitaires** (par module) : capacités, scores, signatures, file,
   quorum, idempotence. Objectif : couverture des chemins critiques.
2. **Intégration** (2–3 nœuds locaux) : découverte < 10 s, affectation de
   bout en bout, reprise après kill d'un nœud.
3. **Chaos** : churn 25 % injecté, partitions simulées, nœud menteur
   (résultat falsifié → écarté du verdict, pair signalé ; l'exclusion
   réseau reste **[PRÉVU]** M4 et n'est jamais affirmée en M2).
4. **Benchmarks** : protocole fixe (matériel, charge, répétitions ≥ 5),
   journaux bruts versionnés, baselines obligatoires.

## 2. Baselines de comparaison

- B0 : exécution locale mono-nœud (référence temps).
- B1 : round-robin pondéré sans Muse (référence ordonnancement, pour O5).
- B2 : centralisé simulé (un nœud fait tout, mesure le coût réseau).

## 3. Métriques

Makespan, taux de complétion sous churn, surcoût de vérification (%),
temps de détection + reprise, appels Muse (nombre, latence, coût estimé),
taux de désaccord du quorum.

## 4. Interdictions

Aucun appareil fictif dans les rapports ; le matériel émulé est étiqueté
« émulé ». Aucune moyenne sans écart-type ni nombre de répétitions.
Un test qui échoue bloque le jalon : on corrige ou on déclasse la
fonctionnalité en **[PRÉVU]**.

## 5. Gates par jalon

M1 : découverte + heartbeat à 3 nœuds ; robustesse trames (null, types,
clé malformée, trame géante, UTF-8 fragmenté) sur vrai processus.
M2 : quorum avec menteur (résultat écarté, pair signalé NON exclu) ;
pannes synchronisées sur affectation observée (pas de délai arbitraire) ;
timeout + réaffectation ; reprise coordinateur après kill (persistance) ;
terminaison franche sans exécutant.
M3 : bascule Muse→repli testée (Muse coupé, la démo continue).
M4 : suite bench complète + journaux. M5 : démo rejouée 3 fois sans échec.

## 6. Discipline d'exécution (leçon 2026-10-26)

- Suites exécutées **séquentiellement**, jamais en parallèle : deux suites
  simultanées se volent les ports (statut +100 dans la plage TCP voisine)
  et produisent des échecs/timeouts fallacieux. Ports de statut des tests
  décalés de +500 (`STATUS_GAP`) ; timeout runner `--test-timeout=120000`.
- Tout run parallèle ou avec orphelins de runs précédents est **invalidé**
  et rejoué seul ; les processus de test orphelins sont identifiés par
  ligne de commande et tués avant re-run (jamais de kill aveugle).

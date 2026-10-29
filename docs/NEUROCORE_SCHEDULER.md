# NeuroCore — Ordonnanceur (NT-FLOW)

## 1. Algorithme

Pour chaque nœud (ordre topo) : pour chaque worker, `evalPlacement`
(coût + incertitude) ; `prefer` applique l'hystérésis (gain ≥ 10 %
pour changer) ; inputs avec leur premier consommateur (0 transfert) ;
plan validé par l'arbitre. Coût : calcul/flops appris (+mesuré,
+1 Mflops conservateur), transfert/débit, conversion, codec, pénalité
fiabilité ≤ +50 %.

## 2. Comparaison aux classiques (bench §13)

- Round-robin : aveugle, transferts forcés (10240 o sur le workload).
- Capacités (greedy flops) : optimal statique à workers équivalents.
- NeuroCore D (sans apprentissage) : même décision que greedy +
  surcharge ~0,9 ms (plan + vérification).
- NeuroCore E (avec apprentissage) : mêmes verdicts, surcharge
  ~0,5 ms ; l'apprentissage sert la FIABILITÉ (pénalité des fautifs,
  replan) plus que le makespan à workers équivalents.

## 3. Files, idempotence, énergie

Files prioritaires : ordre topo + vagues (hérité §5) ; réaffectation
sur déconnexion via timeout M2 ; tâches déterministes = idempotentes
(re-exécution sûre, prouvée par la vérification) ; checkpoints :
[PRÉVU] (reprise globale actuelle) ; compression/dedup : NT-Flux
branché sur les jambes (bench E NT-FUSION : 10240→7217 o) ;
énergie : NON mesurée [RECHERCHE] ; toute décision est journalisée
(`decisions`, borné 100, exportable).

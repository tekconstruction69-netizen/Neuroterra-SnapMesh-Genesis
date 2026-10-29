# 07 — Limites, risques et travaux restants

## Limites prouvées ou assumées

- **Une seule machine.** Tous les workers sont des registres/processus
  locaux ; les asymétries S1/S3 sont ÉMULÉES (facteurs appliqués aux
  registres). Aucun gain réseau, aucune latence réelle, aucun débit réel
  n'est démontré. Deux appareils physiques : **[PRÉVU]** (procédure M6,
  NON EXÉCUTÉE).
- **Fil compté, pas mesuré.** Les octets sont exacts ; leur coût temps
  vient du débit déclaré/défaut, pas de sockets. `executeGraph` exécute
  localement et n'impose pas la compatibilité backend du plan (la garde
  est `validatePlan` avant exécution ; le chemin réseau M2 repasse par
  les ops bornées).
- **Modèle de coût partiel.** Chemin critique sans contention (deux nœuds
  sur un worker sont supposés parallèles au-delà de la mémoire), casts
  au débit constant calibré, codec en raw par hypothèse au plan (bénéfice
  seulement mesuré sur tampon réel), énergie `null` (aucun capteur
  fiable ; jamais inventée), thermique/batterie seulement si la
  télémétrie les expose (souvent `non mesurée` ici).
- **Recherche bornée.** Exhaustif ≤ 50 000 combinaisons ; au-delà,
  faisceau déterministe sans garantie d'optimalité. Graphe ≤ 64 nœuds,
  tenseurs 2D, 4 kinds : pas de conv/attention/LLM (EdgeShard/EdgeTP
  traitent ce périmètre, hors du nôtre).
- **Pessimisme froid.** β par défaut pénalise tout worker sans historique
  (incertitude 1) : un appareil rapide nouvellement joint peut être évité
  jusqu'à épreuve. L'épreuve locale ne prouve pas un appareil distant ;
  un pair menteur sur ses mesures reste couvert seulement par
  reçus + quorum/re-calcul (§7), jamais par l'empreinte de l'épreuve.
- **Sécurité inchangée.** STOP prioritaire, budgets, consentement par
  appareil et START/STOP (`mesh-safety`/`mesh-app`) restent les gardes ;
  NT-ADAPT ne modifie ni pare-feu, ni service, ni politique réseau, et
  n'exécute que les kinds fermés du graphe.

## Risques

Sur-interprétation des makespans modèle (d'où la décomposition
calibration/recherche en 06) ; tolérance int8 (3 %) inadaptée à une
charge à grande dynamique sans borne par tenseur ; dérive d'un worker
entre épreuve et exécution (EWMA + replan atténuent, ne garantissent pas).

## Travaux restants (par ordre)

1. Bench 2 appareils physiques (M6) avec liens mesurés, puis H2 sur
   charges ≥ 10 ms (convergence d'erreur de prédiction).
2. Épreuve distribuée signée NT-ID + corroboration quorum, expiration
   des reçus d'épreuve.
3. Contention par worker dans le chemin critique ; bornes d'erreur
   propagées par nœud (échelle int8 par tenseur) plutôt que rtol global.
4. Branchement du bénéfice codec mesuré sur les jambes réelles du pont
   M2 (tampons concrets), et rejeu panne sur 2 processus.

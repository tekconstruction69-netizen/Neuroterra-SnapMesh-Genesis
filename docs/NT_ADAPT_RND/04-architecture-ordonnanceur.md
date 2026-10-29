# 04 — Architecture de l'ordonnanceur autonome

## 1. Pipeline NeuroCore (10 étapes, sans Muse au runtime)

Réception/classification (`classify`, presets ou graphe explicite) →
découverte (registres NT-CAP/NT-COMPAT des workers connus) → vérification
de compatibilité (`checkAssignment`) → génération de plans (local,
round-robin, glouton actuel, NT-ADAPT) → estimation des coûts +
incertitudes (NT-COST/NT-LEARN) → exclusion des plans incompatibles ou
dangereux (arbitre `validatePlan`, mémoire cumulée, deadline, frein
safety) → sélection (ci-dessous) → exécution surveillée (retry/replan
sans le worker fautif, `flow.js` inchangé) → vérification (exacte par
défaut ; tolérante via `verifyTolerance`) → restitution + observation
EWMA bornée (durées/comptes uniquement). Testé avec fetch espion :
aucun appel Muse/fetch, même avec clé configurée.

Muse (Meta Muse, temps de conception) peut *proposer* des plans via les
contrats existants ; l'arbitre déterministe re-valide toujours, le repli
local/déterministe fonctionne sans lui ni Baseten.

## 2. NT-ADAPT (`neurocore/src/adapt.js`) [FONCTIONNEL, même hôte]

- `planAdapt(graph, workers, opts)` : énumère les affectations des nœuds
  de calcul (exhaustif ≤ 50 000 combinaisons, sinon faisceau déterministe
  largeur 200, signalé `searchMode`), place les inputs chez leur premier
  consommateur, évalue chaque candidat complet, rejette avec compteurs
  motivés, retient le meilleur chemin critique pessimiste, puis applique
  le repli local explicite. Départage déterministe (makespan, octets,
  ordre lexicographique).
- `evaluateAssignment` : `finish(nœud) = coût pessimiste + max_dép
  (finish(dép) + transfert si coupe)` ; somme et octets fils rapportés ;
  énergie seulement si `powerW` mesuré, sinon `null`.
- `probeWorker` / `seedLearnerFromProbe` : épreuve réelle (03 §2).
- `verifyTolerance(actual, expected, {rtol, atol})` : maxAbs/maxRel/pire
  position ; `measureLegWire(buf, {bps})` : compression seulement si
  `(octets gagnés)/débit > coût CPU mesuré` (NT-Flux réel).
- Intégration : `new NeuroCore({strategy:'adapt', adaptOpts})` ;
  défaut `'legacy'` strictement inchangé (non-régression 15/15).

## 3. Ce qui perd, et pourquoi (attendu, mesuré en 06)

Surcharge de recherche (~0,3–0,8 ms) sans bénéfice sur petits graphes
symétriques (repli local choisi, à raison) ; pessimisme froid qui retarde
l'adoption d'un worker rapide jamais éprouvé ; exhaustif inutilisable
au-delà de la borne (faisceau = heuristique, plus d'optimalité prouvée).
Dans ces cas B0/B2 restent préférables : NT-ADAPT doit le *dire* (reason)
plutôt que forcer un plan distribué.

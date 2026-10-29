# NeuroCore — Apprentissage (NT-LEARN)

## 1. Modèle

EWMA α=0.3 par `(op, worker, dtype)` : `{done, failed, msEwma, flops}`.
Flops appris = flops/tâche ÷ ms (EWMA), utilisé par NT-COST quand
≥ 1 observation (sinon sonde, sinon 1 Mflops conservateur).
Fiabilité = done/(done+failed), pénalité ≤ +50 %.

## 2. Stabilités prouvées (tests)

- Convergence exacte sur signal stable (ewma → 2,000 ms).
- Hystérésis : gain < 10 % ⇒ pas de bascule (anti-oscillation).
- Dérive : 2 surprises > 3× ⇒ reset (points aberrants NON appris).
- Borne : 500 fiches LRU ; que des durées/comptes (vie privée).
- Validation déterministe : l'apprentissage ne fait jamais accepter
  l'incompatible (NT-COST tranche avant).

## 3. Limites mesurées (bench E)

À charges sub-ms, l'erreur de prédiction reste bruitée
([0.40 0.37 0.19 0.26 0.66] par rep — pas de décroissance visible) :
l'ordonnanceur mesure son propre bruit. L'apprentissage est donc
VALIDÉ en unitaire mais son bénéfice makespan NON DÉMONTRÉ à cette
échelle ; charges ≥ 10 ms et workers asymétriques requises pour le
prouver ([PRÉVU] : bench asymétrique). Aucun grand modèle entraîné.

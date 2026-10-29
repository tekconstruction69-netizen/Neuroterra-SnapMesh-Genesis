# M5 — Limites et non-execute (a lire avant toute revendication)

## 1. Non execute (materiel/consentement manquants)

- `M5-TEST-LOCAL.ps1` hors sandbox : NON EXECUTE (EACCES en sandbox).
- Pilote `m5-neurocore-run.js` sur sockets reels : NON EXECUTE.
- LAN deux PC : NON EXECUTE (second PC + consentement requis).
- Variante NeuroCore inter-machines (distribute depuis PC-A) : [PREVU].
- Muse live : variables absentes, appel reel en attente de decision.

## 2. Limites mesurees (pas des defauts caches)

- DML plus lent que CPU sous 256² ; CUDA/NPU absents du PC de reference.
- Sub-ms local = bruit, pas des gains (seuils : tailles >= 10 ms si demandes).
- `Get-NetIPAddress` et `listen` bloques en sandbox : diagnostics, pas Genesis.
- Pas de partitionnement de modele : inferences independantes reparties.
- Quorum 2/3 = redondance, pas preuve crypto ni protection collusion.
- Energie/batterie/thermique : NON mesurees [RECHERCHE] ; politique
  conservatrice + protections natives par defaut.

## 3. Perimetres des tags

- [FONCTIONNEL] = teste avec journal brut cite, dans le perimetre precise
  (meme hote / unit / sandbox-diagnostic).
- [PREVU] = concu et documente, script ou code manquant identifie.
- [RECHERCHE] = piste ouverte, aucune revendication.
- NON EXECUTE = pret mais jamais tourne dans le perimetre vise.

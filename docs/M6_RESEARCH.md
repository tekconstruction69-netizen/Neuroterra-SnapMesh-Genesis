# M6 — Recherche NT-ADAPT 2

## Mécanisme [FONCTIONNEL, décision même hôte]

`routeRequest` génère et compare des candidats **hosting** (modèle
entier, coût de chargement + transfert du modèle si non caché),
**distribué** (`planAdapt` : recherche globale, chemin critique
pessimiste, mémoire cumulée) et **cloud** (repli, jamais appelé dans le
prototype). Facteurs : débits mesurés par épreuves (`probeWorker`,
matmul/add/cast réels + erreur vs oracle), RAM/plafonds des registres
(VRAM : seulement si un backend la déclare — jamais inventée), ops et
dtypes réels (`checkAssignment`), tailles à transférer, latence/débit
par lien (`netBps`, défaut documenté), cache (`cachedOn`, `loadMs`),
fiabilité apprise (done/failed EWMA, seuil `minReliability`),
contribution (frein safety + budgets), confidentialité/localisation
(`localOnly`, `allowedWorkers`, `deniedWorkers` — écartés avec motif).
Énergie/thermique : seulement si télémétrie réelle, sinon `null`/conservateur.
Refus de distribuer : explicite (`refusedDistribution` + motif), repli
local si le gain < marge (défaut 5 %). Stabilité de liaison : aujourd'hui
réduite à fiabilité d'exécution apprise ; RTT/heartbeat temps réel =
**[PRÉVU]** (champ `rttMs` des caps, non consommé par le coût).

## Différences avec l'existant (descriptions vérifiées, aucune nouveauté revendiquée)

- **Petals** : sert de grands LLM par couches chez des volontaires
  Internet (confiance publique, poids chez des tiers). Genesis vise des
  appareils **consentis et identifiés** d'une organisation, tâches
  bornées whitelistées, refus local possible ; pas de LLM par couches.
- **exo** : cluster d'appareils personnels (surtout Apple/MLX) partageant
  un modèle par couches sur LAN. Genesis est OS/moteur-neutre (sondes),
  avec arbitre de compatibilité et quorum, sans couche LLM.
- **ONNX Runtime** : partitionne un graphe entre Execution Providers
  **dans un appareil** (repli CPU). Genesis réutilise ORT comme moteur
  local et ajoute sélection **entre appareils** (coûts réseau/mémoire).
- **OpenVINO** : pile Intel (CPU/iGPU/NPU). Candidate comme backend sondé
  futur **[PRÉVU]** (absent ici), pas comme ordonnanceur.
- **llama.cpp** : moteur local GGUF CPU/GPU léger (RPC expérimental).
  Adaptateur futur possible **[PRÉVU]** ; Genesis n'héberge pas de LLM
  token-par-token (fragments non indépendants, déjà documenté).
- **vLLM** : service GPU datacenter à haut débit (batching, KV paginé).
  Hors périmètre edge consenti ; référence de contraste seulement.

Contribution étroite testée : l'assemblage réfutable (recherche globale
× mémoire cumulée × épreuves × contraintes de confidentialité × repli
motivé) dans un moteur autonome sans IA au runtime. Cf.
`docs/NT_ADAPT_RND/02-hypotheses-nouveaute.md`.

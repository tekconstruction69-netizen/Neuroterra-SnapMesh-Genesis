# NeuroCore — Architecture

> Orchestrateur distribué AUTONOME : planifie, exécute, vérifie et
> restitue SANS appeler Meta Muse (ni aucun LLM) au runtime.
> Prouvé : run complet avec `fetch` espion qui lève + `MUSE_API_URL`
> configurée (test `autonomie`). Adaptateurs Muse conservés, optionnels,
> désactivés par défaut, compatibilité inchangée (M2 32/32, muse 11/11).
> Statuts : [FONCTIONNEL] testé · [PRÉVU] · [RECHERCHE].

## 1. Principe

Muse conçoit (cette session), NeuroCore exécute (toujours). Le chemin
réseau des tâches (M1/M2) ne contient AUCUN appel distant d'IA :
`neurocore/` n'importe ni `fetch`, ni les adaptateurs `muse.js`.

## 2. Modules (`neurocore/src/`)

| Module | Rôle | Preuve |
|---|---|---|
| `cost.js` (NT-COST) | tCalcul/flops appris + tTransfert/débit + tConversion + tCodec, fiabilité, incertitude ; refuse l'incompatible motivé | unit (incertitude 1→<0.5, refus bf16) |
| `learn.js` (NT-LEARN) | EWMA α=0.3 par (op,worker,dtype), hystérésis 10 %, reset sur dérive ×2, borne 500, export/import | unit (convergence, anti-oscillation, dérive, LRU) |
| `recompose.js` | `chooseCut` (avant/après cast) + `chooseSplit` (mono vs split-2..8, hystérésis) expliqués | unit |
| `flow.js` (NT-FLOW) | classify → graphe → plan → exécution → observation → replan secours → re-calcul vérifié → restitution ; journal borné | 7/7 (exactitude 3 presets, panne, frein, reprise) |

## 3. Pipeline d'une demande

1. `classify` : preset (`chain-matmul-fp32`, `mixed-fp32-int8`,
   `batch-add`) ou graphe explicite validé (jamais de code).
2. `plan` : coût total appris par nœud/worker + préférence avec
   hystérésis ; arbitre `validatePlan` (NT-COST/compat) ; frein safety
   avant tout placement.
3. `run` : `executeGraph` réel ; chaque durée alimente `learner` ;
   panne → replan sans le worker fautif (reprise globale) ;
   vérification = re-calcul du final (déterminisme) ; restitution
   `{value, proofs:{plan, metrics, verified, overheadMs, decisions}}`.
4. Refus propre : frein fermé → `refused` ; incompatible → `failed`
   motivé (0 décision invalide exécutée au bench).

## 4. Résilience (NT-SURVIVE) et confiance (NT-TRUST)

- État local + `exportState`/`importState` (learner + décisions) :
  un coordinateur temporaire reprend (testé). Déduplication par ids,
  journal minimal vérifiable (registre §7/NT-PQ réutilisés).
- Partitions, multi-sauts, LAN vs overlay : MÊMES limites que M1
  (pas de communication sans support physique ; relais 1-saut).
- Confiance : NT-ID/NT-CERT/NT-UCP réutilisés ; PQ composé quand
  justifié ; signatures ≠ preuve de calcul (quorum/re-calcul §7).

## 5. Limites

Workers testés = registres locaux ; 2 appareils/LAN : NON EXÉCUTÉ.
Reprise = globale (checkpoints [PRÉVU]). Tokens LLM : NON fragmentés.
Mémoires non agrégées (jamais revendiqué).

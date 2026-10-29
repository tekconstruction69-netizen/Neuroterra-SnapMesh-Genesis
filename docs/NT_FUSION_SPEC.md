# NT-FUSION — Spécification

> Architecture expérimentale : composition automatique de graphes de
> calcul exécutables sur appareils hétérogènes et intermittents, avec
> optimisation conjointe compatibilité / transferts / sécurité /
> fiabilité / ressources. Statuts : [FONCTIONNEL] testé · [PRÉVU] ·
> [RECHERCHE]. Modules : `nt-compat/`, `nt-fusion/`, `nt-pq/`.

## 1. Hypothèse

Un planificateur cognitif (Muse) proposant des placements, TOUJOURS
validés par un arbitre déterministe avant exécution, avec repli
déterministe sans IA, bat les stratégies aveugles sur le coût total
(calcul + transferts) sans jamais placer l'incompatible.

## 2. NT-COMPAT [FONCTIONNEL]

`nt-compat/src/` : `backends.js` (détection réelle : `node-cpu-fp64`
mesuré en flops, `node-cpu-fp32` Float32Array, `node-cpu-int8` JS pur ;
onnxruntime/directml/cuda/rocm/openvino/webgpu/webnn = absents avec
motif — jamais inventés), `registry.js` (registre v1 : profil NT-CAP
joint + backends + plafond mémoire = moitié RAM libre), `tensors.js`
(tenseurs réels : fp32/fp64, quantification symétrique int8 zéro-exact,
matmul entier Int32, conversions explicites), `validator` =
`checkAssignment` (backend/dtype/mémoire/threads, refus motivés).
Tests : 5/5 (oracles indépendants, erreur int8 bornée).

## 3. Graphe FUSION [FONCTIONNEL]

`nt-fusion/src/graph.js` : DAG typé v1 (`input|matmul|add|cast`,
`fp64|fp32|int8`, deps + `$node` ∈ deps, 64 nœuds max, shapes 1..512).
Règle d'or : **conversion implicite interdite** — un `cast` explicite
est exigé entre dtypes différents. `inferShapes` + `estimateFlops`
propagent les coûts exacts (octets, flops) pour le planificateur.
`execute.js` : exécution réelle avec retry (`retryMax` 0..3), timeout,
métriques par nœud (ms, octets, worker, tentatives). Chaîne int8 :
re-quantification explicite documentée (erreur bornée testée).

## 4. Planification [FONCTIONNEL sauf live]

- `planner.js` : greedy déterministe (coût calcul flops mesurés +
  transferts au débit connu, défaut loopback 25 Mio/s documenté) +
  `validatePlan` (re-vérifie chaque affectation nt-compat).
- `muse.js` : Muse PROPOSE 1..3 plans (contrat v1 strict, budgets,
  timeout, fetch injecté), l'arbitre ne garde que les valides ;
  repli = greedy + round-robin SIGNALÉS (~µs). Appel distant live :
  NON EXÉCUTÉ (aucune clé) — testé via mock (plan invalide écarté).
-STOP/safety : le frein `brake` reste consulté avant tout placement
  M2 ; FUSION ne place que sur workers autorisés (registre + budgets
  utilisateur). Aucune exécution arbitraire (kinds fermés).

## 5. Vérification et registre (M6) [FONCTIONNEL]

Reçus §7 (Ed25519) et PQ (ML-DSA) distingués par `kind` ;
`ledger.js` : registre append-only chaîné sha256, vérifiable
hors-ligne (chaîne + signatures), export/import JSON. Sépare identité
(clé), réception (reçu signé), résultat vérifié (empreintes), preuve
de calcul (quorum/re-calcul — hors registre). Ancrage blockchain :
[PRÉVU], optionnel, exécution toujours hors chaîne.

## 6. Limites et suite

- Workers testés = registres de CETTE machine (processus locaux) ;
  2 appareils / LAN : NON EXÉCUTÉ. LLM (tokens) : NON traité comme
  fragments indépendants (pas d'architecture d'inférence adaptée).
- Backends GPU/NPU : détectés absents ici ; ONNX/DirectML = [PRÉVU]
  si toolkits installés (matrice : `NT_COMPAT_MATRIX.md`).
- Réseau « quantum-safe » : NON revendiqué (cf. `NT_PQ_SECURITY.md`).

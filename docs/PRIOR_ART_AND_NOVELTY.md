# État de l'art et nouveauté Genesis

> Faits vérifiés le 2026-10-26 (documentation officielle et presse
> technique). Aucune unicité mondiale revendiquée sans preuve.

## 1. Ce qui existe (vérifié)

- **ONNX Runtime + Execution Providers** : abstraction éprouvée
  (CUDA, TensorRT, DirectML, CoreML, OpenVINO, ROCm, QNN, XNNPACK,
  WebGPU/WebNN côté web). Le graphe est partitionné en sous-graphes
  par EP. Genesis ne réinvente pas cela : NT-COMPAT prévoit un backend
  `onnxruntime` [PRÉVU] dès le paquet installé.
- **Windows ML / DirectML** : inférence Windows sur GPU via DirectX 12 ;
  accessible en Node uniquement via onnxruntime (absent ici).
- **CUDA / ROCm / OpenVINO** : toolkits propriétaires/constructeurs,
  hors Node pur ; détection honnête = absents ici.
- **WebGPU/WebNN navigateurs (2026)** : WebGPU ~10× JS, cible prod ;
  WebNN expérimental (Chromium seul, NPU rare) ; Safari/iOS partiels ;
  chaîne de repli WebGPU→WebNN→WASM→cloud. Inaccessibles en Node pur.
- **Ordonnanceurs distribués** (Ray, K8s, Slurm…) : placement de
  tâches génériques, pas de co-optimisation codecs/transferts/PQ ni de
  validateur de compatibilité dtypes par tâche.
- **Partitionnement de graphes / placement de tenseurs** : pratiques
  standard du distribué ML (pipeline/model/data parallelism) ; notre
  graphe typé avec `cast` explicite obligatoire reprend l'idée à
  petite échelle vérifiable.
- **PQ standardisée** : FIPS 203/204/205 finalisés 08/2024 ; node:crypto
  les expose (sonde OK) ; l'hybride X25519+KEM est la pratique de
  migration recommandée (ne jamais abandonner le classique d'abord).

## 2. Ce que Genesis réutilise

M1/M2 (transport, identités, quorum non-crypto), DAG §5 (topologie,
$ref, merges), pattern Muse-propose/arbitre-dispose (§6, NT-Flux),
reçus §7, NT-Flux (transferts), safety (frein STOP, budgets).

## 3. Ce que nous proposons (nouveau, testé)

1. **Validateur d'affectation par tâche** (backend×dtype×mémoire×
   threads, refus motivés) adossé à une détection locale honnête
   (jamais de backend inventé) — 5/5.
2. **Graphe typé à conversion explicite obligatoire** + exécution
   réelle fp32/int8 avec erreurs bornées mesurées — 7/7.
3. **Arbitre systématique des plans IA** (aucun plan Muse exécuté sans
   re-validation compat ; mock distant prouvant l'écart des invalides).
4. **Session hybride X25519+ML-KEM-768 + reçus ML-DSA + registre
   vérifiable hors-chaîne**, avec surcoût mesuré et refus du label
   « quantum-safe » — 6/6.
5. **Co-optimisation transferts (NT-Flux) × placement** mesurée
   bout-en-bout (E : 10240 → 7217 o sur tenseurs réels).

## 4. Non-nouveau / limites

Partitionnement, quantization, hybride PQ, registres chaînés : idées
connues, assemblées ici de façon vérifiable. Inférence LLM distribuée,
vrais GPU/NPU, 2 appareils, Muse live : NON démontrés.

# NT-COMPAT — Matrice de compatibilité

> Relevé réel du 2026-10-26 sur ce poste (Ryzen 7 7435HS ×16, Node
> v24.14.0, Windows 11) via `detectBackends({benchN:48})`. Toute autre
> machine produit sa propre matrice (jamais copiée).

| Backend | État ici | Dtypes | Perf mesurée | Accès si présent |
|---|---|---|---|---|
| node-cpu-fp64 | ✅ | fp64 | ~223 Mflops (matmul 48×48) | V8 natif |
| node-cpu-fp32 | ✅ | fp32 | ~438 Mflops | Float32Array |
| node-cpu-int8 | ✅ | int8 | non mesuré en flops (entier JS) | quantize + Int32 |
| onnxruntime | ❌ non installé | fp32 (si installé) | — | `npm i onnxruntime-node` [PRÉVU] |
| directml | ❌ | fp32/fp16 | — | via onnxruntime EP [PRÉVU] |
| cuda | ❌ (pas de NVIDIA) | fp32/fp16 | — | toolkit + GPU [RECHERCHE ici] |
| rocm | ❌ | — | — | [RECHERCHE] |
| openvino | ❌ non installé | fp32/int8 | — | paquet [PRÉVU] |
| webgpu | ❌ (Node sans WebGPU) | — | — | navigateur/ONNX web [RECHERCHE] |
| webnn | ❌ (navigateur seul) | — | — | Chromium + NPU [RECHERCHE] |

## Règles du validateur (`checkAssignment`)

1. Backend exigé présent ET disponible, sinon refus motivé.
2. Dtype supporté par le backend, sinon `aucun backend pour X`.
3. Mémoire estimée (Σ tenseurs × octets/dtype + marge) sous plafond
   (défaut : moitié RAM libre), sinon refus chiffré.
4. Threads suffisants, shapes 1..4096, tenseurs déclarés.
5. Sans backend exigé : premier compatible (déterministe).

## Formats et conversions

- fp64 ↔ fp32 : arrondi réel du format (Float32Array).
- fp→int8 : quantification symétrique (zéro exact), erreur bornée
  mesurée (< 0,1 sur tests 2×2, < 0,2 en chaîne avec re-quantification).
- int8→fp : déquantification par scale. `int8acc` (Int32) : interne au
  matmul, re-quantifié explicitement entre deux matmul int8.
- bf16/fp16 : REFUSÉS (aucun backend ici) — pas d'émulation silencieuse.

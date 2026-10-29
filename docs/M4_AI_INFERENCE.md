# M4 — Inférence IA réelle (ONNX Runtime)

## 1. Charge reproductible

Modèle `Gemm` Y=X·W fp32 construit en mémoire (`nt-compat/src/
onnx-model.js`, protobuf manuel documenté, opset 13) — AUCUN .onnx
versionné, AUCUN modèle tiers (licence/poids : rien à autoriser).
Vérification : Y[i][j]=X[i][j]·(j+1), erreur 0 exigée.

## 2. Résultats (5 reps, `bench-logs/m4-backends-20261026.json`)

| Charge | JS fp32 | ORT cpu | ORT dml |
|---|---|---|---|
| 16² | **0,010 ms** | 0,087 ms (err 0) | 0,294 ms (err 0) |
| 64² | 0,461 ms | **0,091 ms** (err 0, ×5) | 0,331 ms (err 0) |

Lecture : ORT-cpu ×5 à 64² mais perd à 16² (overhead session) ; DML
fonctionnel mais dominé par le transfert (plus lent que CPU jusqu'à
256² en sonde). **Aucun gain GPU annoncé** : le backend optimal dépend
de la taille — seuils à encoder dans NT-COST ([PRÉVU] : calibration
automatique par backend au démarrage).

## 3. Partitionnement et limites

- Partitionnement testé : découpage FUSION→fragments M2 (pont 2/2),
  pas de parallélisme de modèle LLM (tokens NON indépendants —
  jamais revendiqué).
- Télémétrie ORT (stderr, in-memory ici) : bruit de mesure, pas
  d'échec. Poids > 16² par fragment : borne ops (4 Ko) — grands
  modèles exigeraient streaming ([PRÉVU]).
- DirectML/Windows ML : via ORT uniquement (pas de liaison native).
  CUDA : absent (pas de NVIDIA).

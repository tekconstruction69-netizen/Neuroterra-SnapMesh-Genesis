# M4 — Inventaire matériel (relevé réel, 2026-10-26)

> Commandes : `os.cpus/os.totalmem` (Node), `nvidia-smi` (absent),
> `require.resolve` paquets, sonde ORT (`availableEps`, création de
> session réelle), WMI **refusé** dans ce sandbox (contre-vérification
> hors sandbox documentée, non exécutée ici).

| Composant | Relevé | Statut |
|---|---|---|
| CPU | AMD Ryzen 7 7435HS ×16, x64 | ✅ mesuré (~438 Mflops fp32 JS) |
| RAM | 16,9 Go (4,4 libres au relevé) | ✅ mesuré |
| GPU NVIDIA / CUDA | `nvidia-smi` absent | ❌ pas de CUDA |
| iGPU AMD (Radeon 610M du 7435HS) | accessible via DirectML (EP `dml` ouvre une session et infère exact) | ✅ via ORT/DML |
| NPU (XDNA/AI Boost/Hexagon) | aucun indice détectable en Node pur ; 7435HS = Zen3+ **sans NPU** (spec publique) | ❌ absent de ce silicium |
| onnxruntime-node | 1.31.1 installé (`nt-compat`, optionalDependencies) | ✅ EPs sondés : cpu ✓, dml ✓, cuda ✗ (motif) |
| WebGPU / WebNN en Node | flag inexistant / API navigateur | ❌ |
| WMI/registre pilotes | refusé (sandbox) | ⚠️ à contre-vérifier hors sandbox |

## Règle appliquée (P3/P6)

Backend implémenté SEULEMENT si matériel prouvé : `onnxruntime`
(cpu+dml) intégré (`nt-compat/src/ort.js`, 3/3) ; CUDA/ROCm/NPU :
non implémentés (matériel absent). DML présent mais PLUS LENT que
CPU sous 256² (transfert host-device) — le choix du backend dépend
de la taille (rôle de NT-COST, seuils mesurés au § benchmarks).

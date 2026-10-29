# M5 — Execution IA reelle (sans partitionnement suppose)

## 1. Position honnete

Aucun modele n'est partitionne entre appareils : diviser arbitrairement les
tokens/poids d'un LLM n'est pas une execution distribuee valide. Ce que M5
démontre, c'est le repli autorise par la mission : **plusieurs inferences
independantes reparties entre machines**, chacune executee integralement
par le backend declare, avec preuve par backend.

## 2. Charge de reference (M4, reutilisee)

- Modele : Gemm Y = X·W fp32 construit en memoire (`nt-compat/src/onnx-model.js`),
  jamais de `.onnx` versionne ; session en cache par (n, EP).
- Backends prouves : `cpu=true`, `dml=true`, `cuda=false`
  (`nt-compat/test/ort.test.js` 3/3, rejoues 2026-10-26).
- Exactitude : erreur 0 vs oracle JS (Y=[1,4,3,8] sur le cas de reference).
- Ordres de grandeur M4 (5 reps, `bench-logs/m4-backends-20261026.json`) :
  16² JS 0,010 ms gagne ; 64² ORT-cpu 0,091 ms (x5 vs JS, err 0) ; DML dernier
  sous 256². Ces chiffres sont des MESURES locales, pas des gains revendiques.

## 3. Protocole M5 (volet IA de `M5-TEST-LOCAL.ps1`)

`node scripts/bench-m4-backends.js --reps 5 --out bench-logs/m4-backends-m5-<stamp>.json`
sur chaque PC participant, puis comparaison : latence par (taille, backend),
octets (modeles construits localement = 0 octet transfere — a consigner
explicitement si une distribution de poids est testee un jour), memoire max,
taux de reussite, erreur vs oracle (= 0 exigee).

## 4. Verification du backend declare (M5 section 5)

- Chaque inference loggue son EP (`cpu`/`dml`) et son temps ; `availableEps()`
  (creation de session reelle) fait foi, pas la configuration annoncee.
- Interdit : attribuer a DML/CUDA un temps mesure sur CPU ; presenter une
  moyenne multi-EP comme la performance d'un EP.
- Si ORT absent : erreur `ort-absent` explicite, jamais de simulation
  (test dedie 1/3 de `ort.test.js`).

## 5. Limites

- Pas de NPU/CUDA sur le PC de reference (sonde reelle, pas d'invention).
- DML plus lent que CPU sous 256² : seuils d'usage a encoder [PREVU].
- Calibration NT-COST par backend : [PREVU] (mesures M4/M5 comme amorce).

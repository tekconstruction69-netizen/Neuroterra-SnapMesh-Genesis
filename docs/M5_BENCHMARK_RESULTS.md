# M5 — Resultats benchmarks (mesures, pas promesses)

## 1. Socle M4 reutilise (JSON bruts sous `bench-logs/`)

| Bench | Fichier | Contenu |
|---|---|---|
| NT-Flux A-D | `ntflux-abcd-20261026.json` | brut/adaptatif/dedup, tailles × types |
| NT-FUSION A-E | `ntfusion-abcde-20261026.json` | 1 appareil → FUSION+Flux |
| NT-UCP | `ntucp-poc-20261026.json` | surcout negociation/crypto |
| NeuroCore A-E | `neurocore-abcde-20261026.json` | round-robin → apprenti |
| Backends IA | `m4-backends-20261026.json` | JS vs ORT cpu/dml (5 reps) |
| B0/B1/B2 | `bench-b0b1b2.js` | baselines classiques |

## 2. Comparaisons M5 (A-D, mission section 7)

| Config | Description | Etat |
|---|---|---|
| A. local | 1 appareil, sans reseau | [FONCTIONNEL] socle M4 |
| B. distribue statique | 2-3 processus, round-robin (`M5-TEST-LOCAL`) | script pret, NON EXECUTE hors sandbox |
| C. NeuroCore | placement au cout appris (`m5-neurocore-run.js`) | script pret, NON EXECUTE hors sandbox |
| D. NeuroCore + apprentissage | `Learner` sur observations reelles | [FONCTIONNEL] en unit (109/109) ; terrain NON EXECUTE |

Metriques par config (>= 3 repetitions) : latence bout-en-bout, debit,
octets, memoire max, taux de reussite, reprise apres deconnexion,
surcharge orchestrateur (`overheadMs` NeuroCore), derive prediction/observe.

## 3. Regles de lecture (anti-gains fictifs)

- Aucun gain annonce si l'ecart est dans le bruit (sub-ms local = NON
  significatif, cf. `docs/NT_FLUX_BENCHMARKS.md`).
- `%` cooperatif = part observee, jamais un plafond materiel.
- Toujours citer : n, reps, machine, EP, numero de journal.
- Comparer a conditions identiques (memes matrices, meme quorum).

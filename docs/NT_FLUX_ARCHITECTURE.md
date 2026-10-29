# NT-Flux — Architecture

> Module d'optimisation des échanges SnapMesh : compression et
> déduplication adaptatives. Opt-in, compatible M1/M2 sans les casser.
> Statuts : [FONCTIONNEL] testé · [PRÉVU] spécifié non implémenté ·
> [RECHERCHE] piste non fonctionnelle.

## 1. Objectif

Réduire le coût combiné transmission + latence + calcul + mémoire des
charges TASK/RESULT, en tenant compte des ressources, du réseau mesuré
et du type de données. Aucune tâche ne doit échouer parce qu'une
méthode de compression manque : NT-Flux est optionnel (défaut OFF).

## 2. Module `mesh-flux/` [FONCTIONNEL]

Zéro dépendance externe, `node:zlib` seul. Fichiers :

| Fichier | Rôle |
|---|---|
| `src/codecs.js` | `CODECS` (raw/deflate/gzip/brotli), `announcedSize` (gzip ISIZE) |
| `src/estimate.js` | `detectMagic`, `estimateRatios` (échantillonnage borné) |
| `src/policy.js` | `selectEncoding`, `EFFORTS` (sélection au coût total estimé) |
| `src/dedup.js` | `DedupStore`, `hashOf` (sha256, TTL, quotas, vérif au `get`) |
| `src/flux.js` | `pack`/`unpack` + métriques réelles, `DEFAULTS` |
| `src/muse.js` | Contrat Muse v1, arbitre, heuristique, adaptateur + repli |
| `test/unit.test.js` | 7/7 : codecs, magies, politique, pack/unpack, bombe, dedup, contrat |

### Choix des codecs

`node:zlib` (deflate/gzip/brotli) retenu et justifié : la sonde `lz4`
a prouvé les natifs incompatibles ici sans toolchain (node-gyp sans
compilateur, `docs/OUTILLAGE.md` §3b). Zstandard/LZ4 → [RECHERCHE].

### Règles de décision

- Déjà-compressé (magie gzip/zlib) ou incompressible (échantillon) →
  `raw` : args plains SANS enveloppe, zéro surcoût.
- Sinon codec au coût total estimé (taille × réseau + temps CPU),
  effort `eco|normal|performance`.
- Ratio > 1000× = SIGNALÉ (`metrics.suspicious`), jamais bloquant ;
  la protection réelle est la borne absolue `maxDecompressedBytes`
  (+ pré-refus gzip via ISIZE, sans gonfler).

## 3. Déduplication [FONCTIONNEL]

- `put` de tout plein reçu/décompressé (hash des BYTES JSON).
- `ref` 64 o (sha256 hex) envoyée **seulement après `ack` explicite**
  du destinataire (`dedupAck` dans RESULT, appris dans `fluxKnown`).
- Store **partitionné par expéditeur** (`fluxRecv`) : jamais de
  mélange inter-utilisateurs. Expiration TTL, quotas
  (entrées/octets), vérification d'empreinte au `get`.
- Ref inconnue/invalidée → refus silencieux (`flux-unknown-ref`),
  le coordinateur réaffecte ; après timeout/panne, la ref est
  **oubliée** (`_fluxForget`) : la tentative suivante repart pleine.

## 4. Intégration M1/M2 [FONCTIONNEL, même hôte]

`mesh-compute/src/compute.js`, option `flux` (défaut OFF) :

- Annonce NT-CAP `capsExtra.flux.codecs` (fusion) ; pair sans annonce
  → M2 pur (`plein-legacy`). `_peerFlux()` décide par affectation.
- Coordinateur : `_fluxTaskBody()` → `ref` | `{flux: env}` | plains ;
  mémorise `fluxRefs[taskId]` pour renvoi plein après invalidation.
- Exécutant : `_fluxDecode()` → args (ref/store, flux/unpack gardé,
  plains) ; tout échec = refus silencieux, jamais d'exécution partielle.
- RESULT : `dedupAck: [hash]` + reçu §7 sur args DÉCODÉS (empreintes
  identiques des deux côtés) ; `excludeSelf` (CLI `--no-self`) pour
  forcer le passage par le fil en test/démo.
- CLI `compute-node` : `--flux`, `--flux-effort`, `--flux-no-dedup`,
  `--args-file` (charges > 32 Ko argv Windows) ; logs `[flux]`.
- Stats `flux-stats` send/recv : kind, codec, octets in→out.

Preuves : `mesh-flux` 7/7, `flux-wire` 3/3 (boucle fil JSON réelle,
reçus Ed25519 vrais), `fragments` 11/11, M1/M2 32/32 inchangés.
`flux-e2e` (2 processus TCP) prêt, à exécuter hors sandbox.

## 5. Orchestration Muse [FONCTIONNEL sauf live]

Muse PROPOSE une politique globale (`buildFluxInput` v1 : fragment,
codecs, réseau mesuré, budgets, options), l'arbitre
`validateFluxPolicy` DISPOSE, `selectEncoding` choisit le codec final
localement (lui seul voit les octets). Repli heuristique déterministe
signalé (~9 µs/appel mesuré). Appel distant live : NON EXÉCUTÉ
(aucune clé ici).

## 6. [PRÉVU] / [RECHERCHE]

[PRÉVU] : e2e TCP hors sandbox, LAN 2-PC, renégociation ref (au lieu
d'oubli), quotas `fluxRefs` par tâche, exposition `/status`.
[RECHERCHE] : tenseurs, quantification, caches KV, placement conjoint
tâches-données, énergie mesurée. Jamais d'avec-perte si exactitude
requise.

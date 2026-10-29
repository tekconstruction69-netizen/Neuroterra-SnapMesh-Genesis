# Outillage de développement — installations et versions

> Tenu à jour à chaque installation. Sources exclusivement officielles ;
> périmètre projet sauf mention contraire ; aucun commit ni publication
> effectués sans autorisation.

## 1. Inventaire vérifié le 2026-10-26 (avant installation)

| Outil | Version / source | Verdict |
|---|---|---|
| Node.js | v24.14.0 (`C:\Program Files\nodejs`) | Déjà installé, conservé |
| npm / npx | 11.9.0 (avec Node.js) | Déjà installés, conservés |
| Python | 3.14.3 (`C:\Python314`, officiel) + pip 25.3 + `venv` OK | Déjà installé, conservé |
| Git | 2.53.0.windows.1 (officiel, niveau utilisateur) | Déjà installé, conservé |
| Rust / Cargo | Absent | **Non installé** : non justifié (M1/M2 en Node.js, aucun module natif requis) |
| winget | Présent | Non utilisé (aucun paquet à installer) |
| Droits | Session non-administrateur | Aucune élévation demandée ni effectuée |

## 2. Installations et configurations réalisées le 2026-10-26

1. **`git init` local** (`<repo-root>\.git\`) —
   dépôt local uniquement, **aucun commit, aucun remote, rien publié**.
   Premier commit en attente (identité à fournir, voir §4).
2. **`.venv` Python 3.14.3 + pip 25.3** à la racine projet
   (`python -m venv .venv`, sans réseau, interpréteur système intact).
   Usage : `.\.venv\Scripts\activate` puis `python …`. Aucun paquet installé.
3. **`mesh-net/package-lock.json`** (lockfile v3, zéro dépendance) via
   `npm install --package-lock-only` — versions verrouillées par construction.
4. **`.gitignore` complété** : clés (`*.key`), logs, `node_modules/`,
   `.env`, `.venv/`, artefacts de test.

## 3. Décisions justifiées (pas d'installation)

- **Aucune dépendance npm** : `node:crypto` (Ed25519), `node:net`,
  `node:dgram` couvrent M1. Toute future dépendance sera verrouillée et
  justifiée ici.
- **Aucun paquet pip** : `cryptography`/`nacl` évalués puis écartés (Node
  retenu pour M1) ; tout besoin futur passe par `.venv` + versions épinglées.
- **Pas de Rust** : réévaluer uniquement si un module natif (radio, perf)
  l'exige, avec justification écrite préalable.

## 3b. Sonde NT-Flux 2026-10-26 : codecs natifs lz4/zstd (non installés)

Sonde isolée `.tmp-probe/` (supprimée après, hors git) : `npm install lz4`
depuis le registre officiel (réseau OK, paquet téléchargé), **compilation
native impossible** : node-gyp sans toolchain — `cl.exe`/`gcc`/`msbuild`
absents, `%TEMP%` et `%LOCALAPPDATA%` inaccessibles en sandbox, aucun
compilateur C++ sur la machine. Verdict : **codecs natifs INCOMPATIBLES
ici sans toolchain (installation VS Build Tools = confirmation spécifique
requise, non demandée)**. NT-Flux retient `node:zlib` (deflate/gzip/brotli,
socle Node, zéro dép.) ; zstd/LZ4 classés [RECHERCHE] avec cette preuve.

## 4. Actions exigeant une confirmation spécifique (non effectuées)

Élévation admin, pare-feu, désactivation du sandbox, pilotes, changement
global de sécurité, redémarrage Windows, premier commit (identité),
publication GitHub, déploiement. Constat : le sandbox de session interdit
`listen()` TCP et l'init git non-escaladée ; les tests réseau tournent en
mode escaladé avec approbation, **sans désactiver aucune protection**.

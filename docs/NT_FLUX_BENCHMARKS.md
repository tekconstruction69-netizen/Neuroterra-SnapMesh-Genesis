# NT-Flux — Benchmarks A/B/C/D et avec/sans Muse

> Mesures réelles du 2026-10-26, `bench-logs/ntflux-abcd-20261026.json`
> (34 Ko, paramètres reproductibles inclus). Commande :
> `node scripts/bench-ntflux.js --reps 5 --out bench-logs/<nom>.json`.
> Node v24.14.0, Windows 11, même PC (transport = copie mémoire ;
> réseau réel : voir §5).

## 1. Méthodologie

- Bras : **A** brut · **B** deflate systématique · **C** adaptatif
  (`pack` réel, plains sans enveloppe si `raw` — fidèle à
  `_fluxTaskBody`) · **D** = C puis 2e passe identique en `ref`
  (`DedupStore` réel, 2e transmission = 64 o).
- Types : texte, JSON, aléatoire (incompressible), gzipé
  (déjà-compressé). Tailles : 1 Ko, 16 Ko, 64 Ko, 256 Ko.
- 5 répétitions : médiane rapportée (min/méd/max/moy dans le JSON).
- Mesuré : octets transmis, tPack, tUnpack, CPU/mémoire
  (`process.cpuUsage/memoryUsage`). Intégrité vérifiée à chaque passe
  (`equals`, échec = erreur). Énergie : NON mesurée [RECHERCHE].

## 2. Résultats (médianes, 5 reps)

| Charge | A brut | B syst. | C adaptatif (codec) | D 2e passe | tPack C | tUnpack C |
|---|---|---|---|---|---|---|
| texte 1 Ko | 1024 | 125 | 1024 (raw) | 64 | 0,33 ms | 0,01 ms |
| texte 16 Ko | 16384 | 205 | 443 (gzip) | 64 | 0,53 ms | 0,06 ms |
| texte 64 Ko | 65536 | 393 | 620 (gzip/deflate) | 64 | 1,17 ms | 0,14 ms |
| texte 256 Ko | 262144 | 1157 | 1401 (gzip) | 64 | 1,91 ms | 0,37 ms |
| json 1 Ko | 1032 | 205 | 1032 (raw~gzip instable) | 64 | 0,17 ms | 0,00 ms |
| json 16 Ko | 16493 | 289 | 531 (deflate/gzip) | 64 | 0,63 ms | 0,07 ms |
| json 64 Ko | 65597 | 513 | 753 (gzip/brotli) | 64 | 1,16 ms | 0,12 ms |
| json 256 Ko | 262261 | 1405 | 1649 (gzip) | 64 | 1,94 ms | 0,31 ms |
| aléatoire (tous) | = A | +33 % (base64) | = A (raw) | 64 | 0,4–2,8 ms | ≤ 0,1 ms |
| gzipé (tous) | = A | variable | = A (raw) | 64 | 0,01 ms | 0,00 ms |

## 3. Avec / sans Muse

- Sans Muse (repli heuristique local) : politique `normal`
  déterminée en **~9 µs/appel** (50 appels mesurés), arbitre `ok`.
  Le surcoût décisionnel est négligeable devant tPack (ms).
- Avec Muse distant : NON EXÉCUTÉ (aucune clé ici). Attendu par
  construction : même politique-cadre possible, codec final
  toujours local (`selectEncoding` voit les octets) ; aucun gain
  de débit promis sans mesure.

## 4. Mesuré vs hypothèses

| Hypothèse de départ | Verdict mesuré |
|---|---|
| L'adaptatif bat le brut partout | **Nuancé** : ×26–×227 sur compressible ≥ 16 Ko ; **égal** sous ~1–2 Ko (seuil `raw` : json 1 Ko instable gzip/raw) et sur incompressible/déjà-compressé |
| Le systématique suffit | **Réfuté** : +33 % sur incompressible (base64 sans gain) ; l'adaptatif évite ce piège (plains) |
| Dedup décisif sur répétitions | **Confirmé** : 2e passe 65536 → 64 o (×1024), tout type/taille |
| Coût CPU négligeable | **Confirmé** : pack ≤ 2,8 ms à 256 Ko (échantillonnage inclus) ; unpack ≤ 1 ms ; décision ~9 µs |
| Surcoût enveloppe nul | **Réfuté en partie** : C dépasse B de ~200–250 o sur compressible (JSON + métriques + base64) — piste d'optimisation : enveloppe compacte (binaire ou métriques hors fil) |
| Détection déjà-compressé | **Confirmée** : gzipé → `raw` systématique, tPack 0,01 ms (magie + échantillon) |

## 5. Limites (honnêteté)

- Transport simulé (copie mémoire, latence ≈ 0) : le sandbox de ce
  poste interdit `listen` (EACCES prouvé), donc aucun socket réel ici —
  **y compris pour les suites M1/M2 existantes**, non régressées
  (motif environnemental, pas code). Le temps réseau réel (RTT,
  bande passante, 2 processus) sera mesuré hors sandbox via
  `mesh-compute/test/flux-e2e.test.js` (prêt, ports 48411/48412).
- Bout-en-bout applicatif prouvé sans sockets : `flux-wire` 3/3
  (fil JSON réel, reçus Ed25519 vrais, verdicts exacts distants).
- LAN 2-PC : NON EXÉCUTÉ (procédure `scripts/TEST-LAN-DEUX-PC.md`).
- Énergie/batterie/thermique : NON mesurés [RECHERCHE].

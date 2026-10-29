# M6 — Plan de tests

> Trois portées toujours distinguées : **LOCAL** (même processus/hôte),
> **ÉMULÉ** (facteurs appliqués aux registres, étiquetés), **PHYSIQUE**
> (≥ 2 machines). Un résultat n'est jamais promu d'une portée à l'autre.

## Priorités et état

| # | Test | Portée | État / preuve |
|---|---|---|---|
| 1 | Audit tests M5 + NT-ADAPT | — | Fait : suites relues, NT-ADAPT 8→9 tests (routage ajouté) |
| 2 | Deux PC utilisables ? | PHYSIQUE | **NON VÉRIFIÉ** : aucun pair configuré (`SNAPMESH_PEER`/`M6_PC2_HOST` absents), pas de second poste accessible d'ici → rien supposé |
| 3 | Agent worker installable PC-B | PHYSIQUE (prêt) | `scripts/M6-WORKER.ps1` (PS5.1, ASCII, PSParser 0 erreur, consentement, exit 0/1/2) ; lancement réel NON EXÉCUTÉ (sockets interdits en sandbox) |
| 4 | Bout-en-bout soumission→sélection→exécution IA→validation | LOCAL | **PASS** `scripts/m6-e2e-local.js` (ORT réel + NeuroCore adapt, journal `bench-logs/m6-e2e-2026-10-29.json`) |
| 5 | Local vs répartition simple vs NT-ADAPT 2 | ÉMULÉ (décision) | **PASS** `scripts/bench-ntadapt.js` (B0/B1/B2/B3, cf. NT_ADAPT_RND/06) ; PHYSIQUE [PRÉVU] |
| 6 | Panne, reconnexion, doublons, réaffectation | LOCAL / PHYSIQUE | Panne+replan et doublon déterministe **PASS** (e2e local) ; reconnexion PHYSIQUE [PRÉVU] (scènes 6–9 de `M6_LAN_REPORT.md`) |
| 7 | Latence, débit, RAM/VRAM, octets, erreurs | LOCAL | Latence/octets/erreurs **mesurés** (journaux) ; RAM processus rapportée ; VRAM **non mesurée** (pas de sonde) |
| 8 | Partitionnement petit modèle | Conditionnel | Seulement si le test 5 PHYSIQUE montre un bénéfice ; sinon rester en hosting/distribué de tâches |

## Scénario physique reproductible (hors sandbox, deux opérateurs)

Prérequis : même LAN privé, Node 18+ des deux côtés, dossier projet
identique, pare-feu **jamais modifié par les scripts** (si Windows
demande : réseaux privés uniquement), consentement `OUI` sur chaque PC.

```powershell
# PC-B (worker, ex. coordinateur = 192.168.1.10)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\M6-WORKER.ps1 -Peer 192.168.1.10:49210
# PC-A (coordinateur) — harnais existant, ne pas dupliquer
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\M5-TEST-LAN.ps1 -Role coordinateur
```

Critères : pair `sessionVerified=true`, job exact, `[exec] chiffré=1`,
kill worker → reprise, relance → reconnexion, STOP propre (détail :
`docs/M6_LAN_REPORT.md`). Sans journaux `bench-logs/m5-lan-*` des **deux**
PC, le run reste NON EXÉCUTÉ. Configuration Windows : PowerShell 5.1,
exécution de scripts par `-ExecutionPolicy Bypass` **par invocation**
(aucun réglage système changé), clés `--ephemeral` (rien persisté).

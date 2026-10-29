# M5 — Procedure LAN deux PC (physiques)

> Requiert : deux PC Windows, meme LAN PRIVE (jamais Wi-Fi public/invite),
> Node.js >= 18 (https://nodejs.org), consentement explicite des deux
> operateurs, dossier projet identique (a minima `mesh-compute/` + `mesh-net/`).
> Sans second PC : marquer NON EXECUTE, ne rien simuler.

## 1. Rappel de base (M1, reutilise sans duplication)

Lire d'abord `scripts/TEST-LAN-DEUX-PC.md` : decouverte auto, handshake,
BYE gracieux, preuves a archiver (`bench-logs/lan-2pc-<date>.md`).

## 2. Test M5 (script guide, pare-feu JAMAIS modifie par le script)

Sur chaque PC, PowerShell ordinaire (hors sandbox Muse) :

```powershell
# PC-B (worker) — remplacer l'IP par celle du coordinateur
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\M5-TEST-LAN.ps1 -Role worker -Peer 192.168.1.10:49210

# PC-A (coordinateur + NeuroCore possible)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\M5-TEST-LAN.ps1 -Role coordinateur
```

Le script demande `OUI` explicite, verifie `listen`, affiche les IP locales,
lance le noeud (`--bind-host 0.0.0.0`, ports 49210/49310, discovery 47902),
soumet `batch-fib [20,25,30]` en distant (`--no-self`) et exige
`6765,75025,832040` exacts. Si Windows propose un acces reseau : accepter
uniquement les reseaux PRIVES.

## 3. Scenes a jouer (dans l'ordre, consigner chaque journal)

1. Decouverte + `sessionVerified` des deux cotes (`/status` :49310).
2. Job distant exact (preuve : ligne `[job-lan]` du journal).
3. KILL worker (Ctrl+C cote worker) → le coordinateur marque suspect→dead.
4. Relance worker → re-maillage → second job exact (reprise).
5. DECONNEXION physique (couper le reseau 10 s) → timeout → reaffectation
   ou echec propre documente ; reconnexion → job exact.
6. Archiver : `bench-logs/m5-lan-*.log` des DEUX PC + blocs `peers` JSON.

## 4. Cas particulier : variante NeuroCore inter-machines

Le pilote `m5-neurocore-run.js` est mono-PC. La variante LAN (coordinateur
en-process sur PC-A + workers `compute-node` sur PC-B) est [PREVU] : la
brique `distribute()` est prouvee, seul le script de lancement manque.
Ne pas presenter le mono-PC comme une validation LAN.

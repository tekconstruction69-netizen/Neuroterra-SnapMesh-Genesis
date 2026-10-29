# M6 — Rapport LAN inter-machines (2 PC physiques)

> Statut : PROCEDURE PRETE, démonstration terrain **NON EXÉCUTÉE**.
> Ce document liste les vérifications de sécurité, les commandes exactes
> et les preuves exigées. Aucune section "résultat" n'est remplie sans
> journal brut `bench-logs/m5-lan-*` des DEUX PC.

## 1. Vérifications de sécurité (avant tout lancement)

- [ ] Les deux opérateurs ont lu `scripts/TEST-LAN-DEUX-PC.md` + ce rapport.
- [ ] Consentement explicite `OUI` saisi sur chaque PC (le script l'exige).
- [ ] Les deux PC sont sur le même LAN **privé** (jamais Wi-Fi public/invité).
- [ ] Node.js ≥ 18 depuis https://nodejs.org sur les deux PC (`node --version`).
- [ ] Dossier projet identique (`mesh-compute/`, `mesh-net/`, `scripts/`).
- [ ] **Pare-feu jamais modifié par les scripts.** Au premier `bind 0.0.0.0`,
      Windows propose un accès : accepter uniquement « réseaux privés ».
- [ ] `--ephemeral` : aucune clé persistée (identité régénérée à chaque run).
- [ ] Ops whitelistées uniquement (`fib`, `tmat`… — voir ligne `Ops` des logs) ;
      aucun code arbitraire reçu du réseau n'est exécuté.
- [ ] Bornes actives et logguées : 2 workers, 64 Mo, 5 s/op.
- [ ] Thermique/batterie **non mesurées** en Node pur (cf. `caps.js`) → mode
      conservateur : petits jobs `fib` uniquement, arrêt au moindre doute
      (Ctrl+C = STOP prioritaire, BYE gracieux).
- [ ] Aucun service exposé sur Internet (bind LAN + loopback uniquement).

## 2. Commandes exactes

Sur chaque PC, PowerShell **ordinaire** (hors sandbox Muse), dossier racine
du projet. Ordre : worker d'abord, coordinateur ensuite.

```powershell
# PC-B (worker) — Etape 0 preflight integree, puis OUI au consentement
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\M5-TEST-LAN.ps1 -Role worker -Peer 192.168.1.10:49210
```

```powershell
# PC-A (coordinateur, 192.168.1.10) — remplacer l'IP par la sienne
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\M5-TEST-LAN.ps1 -Role coordinateur
```

Si la découverte auto ne relie pas (plus de 15 s sans pair) : relancer le
coordinateur avec `-Peer <ip-worker>:49210` (connexion manuelle).

## 3. Scènes et critères (dans l'ordre)

| # | Scène | Critère de réussite |
|---|---|---|
| 1 | Préflight 0 KO sur les 2 PC | journaux `m5-preflight-*` |
| 2 | Maillage : 1 pair de chaque côté | `/status` : `peers[0].sessionVerified=true` |
| 3 | Job `batch-fib [20,25,30]` distant | `outcome=done`, `6765,75025,832040` exacts |
| 4 | Caps réelles | lignes `Caps : {...}` : threads/arch/RAM ; `gpu.available=false` |
| 5 | Chiffrement effectif | PC-B `.out.log` : `[exec] ... chiffré=1` |
| 6 | Kill worker → reprise | 2e job `done` sur coordinateur seul |
| 7 | Relance worker → reconnexion | 3e job `done`, pair de nouveau `sessionVerified` |
| 8 | Déconnexion physique 10 s | timeout → réaffectation ou échec propre loggué |
| 9 | STOP | Ctrl+C fenêtre worker → `BYE`, survivant marque `dead` |

## 4. Preuves à archiver (les DEUX PC)

- `bench-logs/m5-lan-coordinateur-*.log` + `.out.log` + `.err` (PC-A).
- `bench-logs/m5-lan-worker-*.log` + `.out.log` + `.err` (PC-B).
- Blocs `[peers-lan]` (sessionVerified, caps, rttMs) et lignes `Caps`.
- Lignes `[exec] chiffré=1` (PC-B) et `[job-lan]` (PC-A).
- Tout écart, refus pare-feu, latence anormale.

## 5. Résultats terrain

NON EXÉCUTÉ — remplir après le run avec les chemins de journaux et les
valeurs observées (latence, RTT, verdicts). Ne rien inventer.

## 6. Limites constatées (sandbox + conception)

- Sandbox Muse : `listen` EACCES + `Get-NetIPAddress` indisponible →
  tout test réseau s'exécute hors sandbox (diagnostiqué, pas contourné).
- 2 processus sur 1 PC ≠ preuve multi-appareils (M5 local reste local).
- Pas de partitionnement de modèle ; inférences indépendantes réparties.
- DML < CPU sous 256² ; CUDA/NPU absents du PC de référence (sonde réelle).
- Quorum ≠ preuve crypto ; signatures ≠ preuve de calcul correct.

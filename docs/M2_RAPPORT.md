# Jalon M2 — Rapport de calcul distribué + audit M1

> Moteur réel : 3 processus exécutent des tâches, votent, survivent aux
> pannes et écartent un fraudeur. Chiffres mesurés uniquement, même hôte.

## 1. Audit M1 (Phase A) — verdict et preuves

**Relu** : `mesh-net/src/{node,protocol,identity,discovery,registry}.js`
+ CLI. **Rejoué** : 12/12 (`bench-logs/m1-20261026-regression*.log`).

| Point audité | Verdict |
|---|---|
| Signatures Ed25519 + id == empreinte(pub) | ✅ vérifié par tests (falsification, usurpation rejetées) |
| Authentification mutuelle (HELLO croisés signés) | ✅ réelle ; sans chiffrement (documenté, M4) |
| Anti-rejeu (seq monotone heartbeat + fenêtre ts ±120 s) | ✅ partiel assumé ; nonces en M4 |
| Gestion des clés (fichier, mode 0o600) | ⚠️ **constat** : ACL observées = groupe sandbox + admins + système + user en Modify → le mode est inopérant sur Windows. Mitigation : DPAPI en M4 ; commande `icacls` à l'utilisateur (non exécutée) |
| Pairs inconnus (TOFU, tout le monde peut rejoindre) | ⚠️ risque accepté et documenté ; mode « confiance » en M4 |
| Injection via PEERS (connexion sortante provoquée) | ✅ durci : max 32 entrées, hôte:port validés, expéditeur rattaché exigé ; résiduel documenté |
| HTTP /status | ✅ loopback uniquement, rien d'exposé |

**Procédures livrées** : `scripts/Test-M1.ps1` (rejouable dans un PowerShell
ordinaire, journal brut horodaté) ; `scripts/TEST-LAN-DEUX-PC.md` (2 PC,
consentement, pare-feu : **non exécuté**, second PC requis).

## 2. M2 implémenté (Phase B)

Paquet `mesh-compute/` (dépendance locale `file:../mesh-net`, 0 externe) :
`src/ops.js` (6 ops déterministes bornées, jamais de code arbitraire),
`src/tasks.js` (UUID, états, expiration, réaffectation, idempotence),
`src/sched.js` (local / round-robin / capacity, interface commune),
`src/verifier.js` (quorum ceil(2n/3)), `src/compute.js` (coordinateur +
exécutant, TASK/RESULT v1), `bin/compute-node.js`
(`--scheduler`, `--submit*`, `--redundancy`, `--sabotage`,
`--discovery-port`, événement `[exec]`).

Règles : redondance 1 → re-calcul local ; n ≥ 2 → accord ceil(2n/3) ;
verdict **attentif** (toutes affectations résolues) → déterministe ;
dissidents **signalés**, jamais exclus auto (M4).

## 3. Résultats réels (`bench-logs/m2-20261026.log`, 14/14)

9 unitaires (< 100 ms) + 5 intégrations sur vrais processus : quorum 3/3
F(25) = 75025 (2,6 s) ; fraude 2-contre-1 écartée, 168 premiers ≤ 1000 ;
kill en cours de tâche → done ; timeout 3 s → réaffectation, done ;
redondance 1 + sabotage → failed + suspect nommé.

## 4. Avertissement quorum (exigé, rappelé)

Le 2/3 **n'est pas** une preuve cryptographique d'exactitude et **ne
protège pas** contre des nœuds collusifs : il ne détecte que fautes
aléatoires et menteur isolé minoritaire. Inscrit dans le code et ici.

## 5. Bogues trouvés par les tests (tous corrigés, rejoués 14/14)

Auto-réponse perdue (`_sendTo` vers soi) ; pollution inter-tests (port de
découverte unique → `--discovery-port`) ; verdict hâtif (régularité
déterministe) ; `node_modules` manquant (`--package-lock-only` ne lie pas).

## 6. Limites et suite

Même hôte uniquement ; pas de GPU ; stragglers attendus jusqu'au timeout
(documenté) ; Muse non branché (contrats - Phase C prêts) ; benchmarks
B0/B1/B2 en M4 avec le harnais déjà disponible (`--scheduler`,
`--submit-count`).

## 7. Consolidation du 2026-10-26 (23/23, même hôte)

Preuve : `bench-logs/validation-m2-20261026.log.txt` (14 unitaires +
9 intégrations). Contrôles ajoutés : résultats sollicités uniquement
(`unsolicited`/`stale`/`wrong-op`/`oversize`/`bad-result`/`duplicate`
rejetés sans toucher votes/charge/verdict, rejets comptés) ; soumission
stricte (redondance 1..5, timeout 100..120000 ms) ; mémoire bornée
(100 soldées max) ; persistance atomique + reprise (`--queue-file`,
`--recover-delay-ms`, test kill coordinateur avec `recovered:true`).
Pannes synchronisées sur `[exec]` observé ; menteur prouvé NON exclu
(résultat écarté + signalé seulement). Incident ports parallèles :
voir M1 section 6 ; runs invalidés rejoués seuls, verts.
Test 2 PC : NON EXÉCUTÉ.

# M5 — Validation terrain (field validation)

> Statut : scripts PRETS et partiellement EXECUTES. Tout resultat sans
> journal brut `bench-logs/m5-*` est NON EXECUTE, jamais echec ni reussite.

## 1. Ce qui est prouve en sandbox (2026-10-26, logs bruts)

| Point | Preuve | Verdict |
|---|---|---|
| `M5-PREFLIGHT.ps1` s'execute, 0 erreur syntaxe | `bench-logs/m5-preflight-20261026-221229.log` | [FONCTIONNEL] |
| Node v24.14.0, ORT 1.31.1 present, 11/11 ports M5 libres, aucune var `MUSE_*` | meme journal | [FONCTIONNEL] |
| `listen()` bloque (EACCES sandbox) | meme journal, KO attendu | [FONCTIONNEL] diagnostic |
| `Get-NetIPAddress` inaccessible en sandbox | meme journal | limite sandbox, pas Genesis |
| 4 scripts PS : 0 erreur_parse (PSParser) | sortie console 2026-10-26 | [FONCTIONNEL] |
| Pont NeuroCore 2/2 + ORT 3/3 rejoues (base intacte) | sortie console 22:13 (EPs cpu=true dml=true cuda=false) | [FONCTIONNEL] |
| `M5-REPORT.ps1` genere `bench-logs/M5-RAPPORT-20261026-221328.md` | fichier genere | [FONCTIONNEL] |

## 2. Ce qui attend le hors-sandbox (commandes exactes, section 10)

1. `M5-PREFLIGHT.ps1` → `listen` doit passer OK, `lan` doit lister une IP privee.
2. `M5-TEST-LOCAL.ps1` → exit 0 : 3 jobs exacts (6765,75025,832040 / 6765,75025 / 832040),
   reprise apres kill, reconnexion, bench IA archive.
3. `mesh-compute/bin/m5-neurocore-run.js` → 3 jobs FUSION exacts (rel < 1e-6),
   panne + reprise, garde-muse consignee, zero appel Muse.
4. `M5-TEST-LAN.ps1` (2 PC) → job distant exact inter-machines.
5. `M5-REPORT.ps1` → `bench-logs/M5-RAPPORT-*.md` final.

## 3. Correction post-test reel (2026-10-26, cause prouvee en sandbox)

Symptome terrain : `job j1 : aucune ligne [job] dans la sortie`.
Analyse (sondes `/tmp`, code, journaux) :
1. **Defaut n°1 — pendaison retry (CAUSE RACINE)** : 3 fragments en vague
   parallele sur des workers a 2 slots `worker_threads` -> au moins un refus
   `sandbox-busy` (refus silencieux, design P8) -> timeout -> `_dispatch`
   avec pool vide -> `_evaluate` branche `redundancy===1` : `if
   (!results.length) return;` = **abandon silencieux** (le timeout censé
   "trancher" avait deja consommé l'affectation). Tache `dispatched`
   eternelle, verdict jamais ecrit. Prouve : sonde 3 TASK -> 2 RESULT puis
   sortie sans JOB ; sonde boucle retenue -> ETAT `assigns=[] results=0`
   fige 21 s. Corrige dans `mesh-compute/src/compute.js` (`_evaluate` :
   re-dispatch si tentative restante, sinon `failed` tranche). Apres
   correction : 4e TASK emis, JOB `done [6765,75025,832040]`.
2. **Defaut n°2 — CLI one-shot sans fin** : `compute-node.js --job/--submit`
   ne terminait jamais (aucun `process.exit`) ; tout pilote attendant la fin
   tombait en timeout. Corrige : arret propre (BYE + sandbox) + code 0/1
   (`[job-exit]`), documente dans l'en-tete du CLI.
3. **Garde-fou verdict** : `awaitVerdict` (timer REF) autour de `submitDag`
   / `submit` dans le CLI — une ligne `[job]`/`[task]` est TOUJOURS ecrite,
   meme en cas de file muette (`verdict-local`, jamais invente comme
   verdict reseau).
4. **Diagnostic script** : `Run-Job` (`M5-TEST-LOCAL.ps1`) dumpe
   exit/HasExited/tailles stdout+stderr+extraits dans le journal au lieu
   d'un `exit=` vide.
5. **Regression** : `mesh-compute/test/job-j1.test.js` rejoue la charge
   EXACTE du CLI (`buildBatchFib(params.ns, params)`, excludeSelf, fil
   simule) : **echouait avant** (timeout 60 s, 1 cancelled), **passe apres**
   (2/2). Combine : **117/117** (`bench-logs/validation-m5-20261026-222911.log.txt`).
6. DIAGNOSTIC DEFINITIF (journaux terrain 223146 + 223315 lus) : workers
   sains (`[peer] connecte`), coordinateur mort en ~130 ms sur
   `stderr : Demarrage impossible : Expected property name or '}' in JSON
   at position 1` (94 o), stdout 297 o (demarrage seul). CAUSE RACINE :
   `Start-Process -ArgumentList` (tableau, PS5.1) mange les guillemets JSON
   nus — prouve en sandbox : envoye `{"ns":[20,25,30]`, recu
   `{ns:[20,25,30]}` (`ARGV:[{ns:[20,25,30]}]`). Le `JSON.parse` du
   `--job-params` levait avant toute soumission. Le moteur n'etait pas en
   cause sur ce point ; le script l'etait (canal argv).
   Corrections : `--job-params-file` (moteur, `compute-node.js`) + validation
   fail-fast AVANT tout socket + `Run-Job`/`M5-TEST-LAN` via fichier (plus
   aucun JSON en argv) + code de sortie source `[job-exit]` + `Guess-Cause`
   + conservation des fichiers en echec (ne plus supprimer avant analyse).
   Regression `job-params-file.test.js` 3/3 (sensible : sans fail-fast, le
   cas invalide mourrait au listen et le test echouerait). Combine :
   **120/120** (`bench-logs/validation-m5-20261026-223716.log.txt`).
   `exit=` vide : `$p.ExitCode` illisible en PS5.1 sur mort precoce —
   contourne par `[job-exit]` (source enfant).
7. ENCODAGE BOM (nouveau symptome terrain : `Unexpected token 'ï»¿'`) :
   `Set-Content -Encoding utf8` (PS5.1) ecrit un BOM EF BB BF que
   `JSON.parse` refuse. Corrige des deux cotes : ecriture
   `System.Text.UTF8Encoding($false)` + `[IO.File]::WriteAllText/WriteAllLines`
   (`M5-TEST-LOCAL/LAN/REPORT`, prouve sans BOM : octets `123,34...`,
   parse Node direct) ET `readJsonFile()` cote moteur (strip un U+FEFF
   initial, invalide toujours rejete ; applique a `--job-params-file` et
   `--args-file`). Regression : `job-params-file.test.js` passe de 3 a
   **7/7** (sans BOM / avec BOM / invalide+BOM / `{}` sans ns / args-file
   BOM). Combine : **124/124**
   (`bench-logs/validation-m5-20261026-224736.log.txt`). Protocoles reseau
   intacts (aucune modification).

## 4. Regles d'interpretation

- Exit 2 = environnement bloque (EACCES / sans consentement), JAMAIS un
  echec fonctionnel. Exit 1 = echec fonctionnel a investiguer.
- Deux processus sur un PC = integration locale, pas preuve multi-appareils.
- Valeurs oracles : fib(20)=6765, fib(25)=75025, fib(30)=832040 (exactes).
- Graphe FUSION pilote : oracle `executeGraph` local, tolerance rel < 1e-6
  (arrondis fp32/fp64 documentes, cf. `neurocore/test/mesh.test.js`).

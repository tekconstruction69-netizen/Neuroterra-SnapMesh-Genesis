# M4 — Benchmarks (A–D + backends)

> Protocoles : `scripts/bench-neurocore.js` (A–E, 5 reps) et
> `scripts/bench-m4-backends.js` (5 reps). Rapports JSON archivés
> (`neurocore-abcde`, `m4-backends`). Réseau réel : NON mesuré
> (sandbox sans `listen`) — octets comptés, temps réseau simulés.

## 1. Backends, même charge (M4, ce poste)

A-JS vs B-ORTcpu vs C-ORTdml : 16² → JS gagne (0,010 vs 0,087 vs
0,294 ms) ; 64² → ORT-cpu ×5 (0,091 vs 0,461 ms, err 0), DML dernier
(0,331 ms). Conclusion : pas de backend universellement meilleur —
seuils par taille (NT-COST [PRÉVU]). Aucun gain annoncé si écart non
significatif : les temps sub-ms sont du bruit (médianes rapportées
avec min/max dans les JSON).

## 2. Distribué A–E (bench-neurocore, rappel)

5/5 partout, 0 décision invalide, récupération OK, surcharge < 1 ms ;
temps non significatifs (documenté) ; E ne bat pas C à workers
équivalents (attendu). Le pont M2 ajoute : exécution distante-sim
exacte (rel 3,6e-8) avec faisceaux §7.

## 3. Non mesuré / simulations

Latence bout-en-bout réseau, débit de tâches multi-machines,
récupération après déconnexion PHYSIQUE, bande passante variable,
GPU asymétriques, 2-PC : NON EXÉCUTÉS (procédures prêtes :
`negotiate-node.js`, `demo-bout-en-bout.ps1`, `TEST-LAN-DEUX-PC.md`).
Journaux et paramètres : `bench-logs/` (versionnables `.log.txt`
sans secrets, vérifiés par `check-export-public.js`).

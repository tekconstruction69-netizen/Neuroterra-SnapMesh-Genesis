# Secure Task Sandbox (§4) — niveau d'isolation réel

> Statut : [FONCTIONNEL] sur le même hôte (loopback). Ce document dit
> exactement ce que le sandbox fait et, surtout, ce qu'il ne fait pas.

## 1. Ce que c'est

Chaque tâche reçue du réseau s'exécute dans un `worker_threads` Node.js
dédié (`mesh-compute/src/op-worker.js`), créé puis détruit par tâche.
Le worker ne charge que `ops.js` (liste blanche + `node:crypto`) : aucun
socket, aucun fichier, aucun secret ne lui est transmis. Seule la paire
`{op, args}` transite, par copie structurée (pas de mémoire partagée).

Le gestionnaire `mesh-compute/src/sandbox.js` applique des bornes réelles :

| Borne | Défaut | Effet prouvé par test |
|---|---|---|
| Durée maximale `execTimeoutMs` | 5000 ms | worker tué (`terminate`), tâche rejetée `sandbox-timeout` |
| Tas maximal `memMb` | 64 Mo | `resourceLimits.maxOldGenerationSizeMb` appliqué à chaque worker |
| Résultat maximal `maxResultBytes` | 1 Mio | rejet `sandbox-result-too-large` avant remise |
| Concurrence maximale `maxWorkers` | 2 | surplus refusé `sandbox-busy` (le coordinateur réaffecte sur timeout) |
| Annulation | par run (`cancel()`) + globale (`shutdown()`) | rejets `sandbox-cancelled` / `sandbox-shutdown` |
| Crash worker | sortie sans message = anomalie | rejet `sandbox-crash` |

Sémantique d'échec : un refus sandbox ne renvoie **aucun** RESULT
(comme une op inconnue ou une panne d'exécutant) ; le coordinateur
réaffecte sur expiration. Aucun rejet ne vote, ne modifie la charge, ni ne
fausse le verdict — prouvé e2e (timeout distant 1 ms → reprise locale,
2/2 `done`, valeur exacte).

Flags CLI : `--sandbox-max-workers`, `--sandbox-timeout-ms`,
`--sandbox-mem-mb` (journalisés au démarrage via `describe()`).

## 2. Ce que ce n'est PAS (honnêteté obligatoire)

- **Pas un sandbox OS.** Même UID, pas de seccomp / AppContainer / chroot /
  espace de noms. `describe()` expose `osSandbox: false` pour que ce soit
  lisible par les outils, pas seulement par les humains.
- **`process.env` reste lisible depuis le worker** (même processus) :
  **aucun secret ne doit figurer dans l'environnement d'un nœud de calcul.**
- Le worker *pourrait* charger `node:fs`/`node:net` s'il le demandait — il ne
  le fait pas (code fixe, 20 lignes, audité), mais rien au niveau OS ne
  l'en empêcherait. La garantie « pas de code arbitre » vient de la liste
  blanche (clé d'op, jamais de code transmis), pas du worker.
- Vérification coordinateur (re-calcul local, redondance 1) et pré-validation
  de soumission restent synchrones en processus : ce sont des chemins de
  **confiance locale** (propres arguments du coordinateur), pas des entrées
  réseau — le chemin réseau (exécutant) est, lui, toujours sandboxé.

## 3. Modèle de menace couvert

| Menace | Couverture |
|---|---|
| Arguments distants malveillants / surdimensionnés | validation de forme + bornes + résultat capé + timeout + tas capé ✅ |
| Op inconnue / code injecté via `op` | impossible : clé de liste blanche, `op-inconnue` rejetée ✅ |
| Worker bloqué / tué / en boucle | timeout + kill, crash mappé, reprise coordinateur ✅ |
| Saturation par N tâches simultanées | `maxWorkers` + `sandbox-busy` ✅ |
| Exfiltration de secrets hôte | NON couvert au niveau OS : mitigation = aucun secret transmis ni en env ✅ (discipline) |
| Exécution avec privilèges OS réduits | [PRÉVU] § ultérieur (compte dédié / intégrité Windows) |
| Collusion, faux calculs corrects en apparence | hors scope sandbox : quorum + re-calcul (`mesh-verify`) |

## 4. Preuves

- `mesh-compute/test/sandbox.test.js` : **10/10** (succès, refus, timeout
  réel, résultat capé, busy, cancel, crash, describe, shutdown, câblage
  `sandboxed:true` — ce dernier en échec avant câblage, prouvé).
- `mesh-compute/test/sandbox-e2e.test.js` : **1/1** (vrais processus,
  timeout distant puis reprise, valeurs exactes).
- Non-régressions après câblage : voir rapport de module ci-dessous.

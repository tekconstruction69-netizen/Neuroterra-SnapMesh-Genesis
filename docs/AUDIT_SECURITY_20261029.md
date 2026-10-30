# AUDIT — Sécurité 2026-10-29 (lecture seule, scénarios reproductibles)

> Sévérités : CRITIQUE / ÉLEVÉ / MOYEN / FAIBLE.
> Mise à jour 2026-10-29 (mission de correction autorisée) : P0-1 et P0-2
> CORRIGÉS et prouvés (voir « Corrections appliquées »). Aucune publication.

## ÉLEVÉ

1. **`Sandbox.shutdown()` ne termine pas les workers**
   (`mesh-compute/src/sandbox.js:151-161`). La boucle marque `settled` et
   rejette les promesses mais n'appelle jamais `worker.terminate()`
   (contrairement à `settle()` ligne 91 et à `cancel()` ligne 144).
   Scénario : STOP global pendant une charge CPU → les threads continuent
   de tourner en tâche de fond. Reproduction : `run()` une op longue,
   appeler `shutdown()`, observer `worker_threads.active` / charge CPU.
   Diff prévu (P0, validation requise) : terminer chaque worker dans la
   boucle avant `clear()`.
2. **`setTargets()` valide partiellement** (`mesh-safety/src/controller.js:43-48`) :
   seul `cpuTarget` est borné (0–50 %) ; `workers`/`concurrent` sont
   assignés sans contrôle de type, et des champs `undefined`/`NaN`/
   `Infinity`/chaînes écrasent les cibles via `Object.assign`.
   Scénario : `POST /api/targets {"workers":"10","concurrent":-1}` →
   `requestBudget` compare des non-nombres. Le mode `NaN` casserait
   l'admission sans erreur explicite.

## MOYEN

3. **Clés d'identité régénérables à la racine des tests** (`data-app.key`,
   `mesh-app/test/data-app-exec.key`) : couvertes par `.gitignore`, jamais
   commitées, mais recréées à chaque run serveur — rappel de ne jamais les
   `git add -A` sans revue.
4. **`requestBudget` reçoit `estMemBytes` ignoré** (controller.js ligne 95) :
   la limite mémoire par tâche vit dans la sandbox (64 Mo), pas dans le
   contrôleur — cohérent mais à documenter si la borne est un jour exposée.
5. **Token local en mémoire du processus serveur** (`newToken()` au
   démarrage) : modèle correct pour boucle locale, mais tout XSS local
   lirait `window.__GENESIS_TOKEN__` — atténué par `no-store`, pas de
   mise en cache HTML, Origin vérifiée (403 sinon), `max-body` 256 Kio.

## VÉRIFIÉ SAIN

- Traversée de chemin statique : garde `f.startsWith(PUB)` + `isFile()`
  (`server.js:182-185`) ; tokens exigés sur POST sensibles ; SSE en
  lecture seule avec Origin vérifiée.
- Quorum 2/3 correctement non présenté comme preuve d'exactitude ;
  anti-rejeu, révocation et signatures testés (M1/M2).
- Sondes batterie/thermique : aucune température inventée nulle part ;
  politique conservatrice appliquée et affichée.
- Historique Git : aucun secret commité (index vérifié, 284 fichiers sains).
- Dépendances : zéro dépendance sauf `onnxruntime-node` optionnel ;
  aucune mise à jour de sécurité en attente identifiée sur ce périmètre.

## Corrections appliquées (2026-10-29, autorisées, non publiées)

- **P0-1 `mesh-compute/src/sandbox.js`** : `shutdown()` termine désormais
  chaque worker actif (`worker.terminate()`), attend la terminaison réelle
  avec borne (2 s), rejette l'en-cours en `sandbox-shutdown`, et pose
  `shuttingDown` : toute exécution post-arrêt est refusée (jamais créée).
  Preuve : `mesh-compute/test/sandbox-shutdown.test.js` — charge CPU
  continue (crible en boucle, worker garanti en vol), `shutdown()` -->
  `{stopped:true, killed:1}`, `active:0`, toutes les tâches rejetées,
  `run()` suivant rejeté `sandbox-shutdown`. Test existant
  `sandbox.test.js` ajusté à la marge (gestionnaire de rejet attaché dès
  l'émission — l'arrêt réel rend le rejet immédiat, l'ancien test laissait
  une fenêtre de rejet non géré).
- **P0-2 `mesh-safety/src/controller.js`** : `setTargets()` refuse
  désormais `NaN`/`Infinity`/`null`/`undefined`/chaînes/booléens/objets,
  clés inconnues, zéro, négatifs, non-entiers et dépassements
  (cpuTarget ]0, 0.50] fini ; workers/concurrent entiers finis 1..64) ;
  un objet vide ou partiel conserve les cibles existantes sans écraser.
  Preuve : 20 cas invalides rejetés + valide accepté en
  `mesh-safety/test/states.test.js`.
- Interface, NeuroCore, NT-UCP, protocoles, tests existants : inchangés
  (hors l'ajustement de test ci-dessus). Git non réinitialisé, aucun
  fichier supprimé, aucun paramètre système modifié.

## FAIBLE

6. Jeton injecté dans le HTML local : acceptable en boucle locale
   authentifiée, jamais servi par Netlify (placeholder intact vérifié).
7. `maxResultBytes` mesuré par `JSON.stringify` : borne réelle mais
   comptée après sérialisation — suffisante pour ce modèle de menace.

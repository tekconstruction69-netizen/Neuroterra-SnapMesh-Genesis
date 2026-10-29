# Conformité hackathon (§10)

> Vérifiée le 2026-10-26. Périmètre : Meta Global AI Developer Hackathon 2026,
> catégorie Push the Frontier. Référence : `docs/HACKATHON_SCOPE.md`.

## 1. Nouveau travail uniquement (new-work-only)

- Tout le code Genesis (`mesh-net`, `mesh-compute`, `mesh-safety`,
  `mesh-app`, `scripts`, `docs`) a été écrit pendant les sessions de
  travail tracées en `docs/JOURNAL.md` (2026-10-26, auteur : architecte
  système Muse + rapports d'audit).
- Les idées historiques Neuroterra servent de **référence architecturale
  uniquement** : aucun dépôt existant recopié, aucun code historique
  réutilisé sans audit — en pratique : **aucune réutilisation** (tout est
  nouveau, zéro dépendance npm : `node:crypto`, `node:net`, `node:http`,
  `node:worker_threads`, `node:test` du socle Node.js 24).
- Bibliothèques tierces : **une seule** depuis M4 — `onnxruntime-node`
  1.31.1 (registre npm officiel, version verrouillée, `optionalDependencies`
  de `nt-compat`, installable sans admin ; code Genesis inchangé sans elle :
  `ortAvailable()` rend le motif et les tests se contentent du repli).
  Socle : Node.js 24.14.0 (`node:crypto`, `node:net`, `node:http`,
  `node:worker_threads`, `node:test`).

## 1bis. Rôle de Muse Code (traçabilité P8/M4)

- Muse Code (propulsé par Meta Muse Spark) est l'outil de
  développement : architecture, génération de code, benchmarks,
  analyse, documentation — chaque session est tracée en
  `docs/JOURNAL.md` avec tests et journaux bruts associés.
- En exploitation, Muse n'est JAMAIS requis : NeuroCore planifie sans
  appel distant (testé avec fetch espion) ; les adaptateurs Muse sont
  optionnels, désactivés par défaut, sans clé sur les appareils.
- Contributions du hackathon : tous les modules (`mesh-*`, `nt-*`,
  `neurocore/`, `scripts/`, docs) + mesures associées ; prêtes pour
  dépôt public nettoyé (`scripts/check-export-public.js` vert, sans
  `.key`/`.env`/`node_modules`/`.venv`), publication soumise à
  autorisation explicite (jamais automatique).

## 2. Dépôt public et publication

- **Aucune publication effectuée** : ni `git commit`, ni `push`, ni tag,
  ni déploiement, ni modification de paramètres système (pare-feu,
  pilotes, sandbox, registre) pendant les missions.
- État git non vérifiable depuis le sandbox d'exécution (dépôt possédé
  par `neuro`, session `muse-sbx-r1` : `git` refuse par `dubious
  ownership`) — **à confirmer par le propriétaire** avant toute
  publication ; aucune commande d'écriture git n'a été émise cette session.
- Règle maintenue : publication GitHub uniquement sur approbation explicite.

## 3. Secrets et sécurité des vérifications

- Balayage des sources (`mesh-*/src`, `bin`, `server.js`, `app.js`,
  `scripts`) : **aucune clé, aucun token, aucun mot de passe**.
- Clés de nœuds : fichiers `*.key` gitignorés, jamais dans les journaux
  versionnés (contrôle par recherche avant chaque copie `.log.txt`).
- Clé/URL Muse : jamais stockées — lues uniquement depuis l'environnement
  au moment de l'appel (`MUSE_API_KEY`, `MUSE_API_URL`) ; aucun appel
  externe émis (aucune clé configurée ici).
- Tests réseau : ports isolés, loopback, suites séquentielles ; exécutions
  privilégiées (`listen`) avec approbation, sans désactiver de protection ;
  orphelins tués sur ligne de commande exacte uniquement.

## 4. Honnêteté des preuves (traçabilité)

- `docs/JOURNAL.md` : une entrée par module (fait, tests, effet jalons).
- `PROGRESS.md` : statuts [FONCTIONNEL]/[PRÉVU]/[RECHERCHE] + périmètres.
- `bench-logs/` : journaux bruts horodatés + copies versionnables
  `validation-*.log.txt` (sans secret) ; simulations jamais présentées
  comme preuves matérielles ; même-hôte systématiquement rappelé ;
  LAN 2-PC : procédure prête, NON EXÉCUTÉ.

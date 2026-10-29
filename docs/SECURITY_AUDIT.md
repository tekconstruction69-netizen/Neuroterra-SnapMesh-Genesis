# Audit de sécurité post-audit indépendant (P1–P3, P8)

> Correctifs appliqués et vérifiés le 2026-10-26. Vérificateur rejouable :
> `node scripts/check-export-public.js` (exit 0 = propre, ce jour).

## 1. Clés et secrets (P1)

- **Trouvé** : 6 clés privées Ed25519 de test versionnables
  (`mesh-app/test/data-*.key`, 65 o, réutilisées entre runs) + 1 reste
  de run à la racine (`data-cmp-24300.key`). Risque : usurpation des
  identités de test + habitude de clés commitées.
- **Corrigé** : `--ephemeral` ajouté à `mesh-app/server.js` ; tests
  migrés (identité par démarrage) ; les 7 fichiers supprimés du disque.
  Vérifié : plus aucun `.key` hors `node_modules/` et `.tmp-*/`
  (tous couverts par `.gitignore` : `*.key`, `.tmp-*/`, etc.).
- **Dépendances** : 0 externe (tout `file:` local, audité package par
  package). `node_modules/` et `.venv/` exclus de tout export.
- **Historique Git** : inaccessible ici (`dubious ownership`, sandbox) —
  à confirmer par le propriétaire `neuro` avant tout `git add` :
  appliquer `.gitignore`, ne jamais forcer l'ajout d'un `.key`.
- **Journaux** : `validation-*.log.txt` scannés (motifs clé/secret) :
  propres. Aucun `.env` dans le dépôt ; secrets Muse par
  `MUSE_API_URL`/`MUSE_API_KEY` en environnement uniquement.

## 2. API locale (P2)

- **Trouvé** : corps sans limite (DoS), aucun contrôle d'origine
  (CSRF depuis un site tiers possible), opérations sensibles sans auth.
- **Corrigé** (`mesh-app/server.js` + `src/guards.js`, `public/app.js`) :
  `MAX_BODY` 256 Ko (413), `originOk` (403 hors boucle locale),
  jeton local 48 hex par démarrage exigé sur tous les POST (401),
  injecté same-origin dans `index.html`. Tests : `guards` 2/2 (logique
  pure) + e2e HTTP 401/403/413 dans `api.test.js` (à rejouer hors
  sandbox — sockets interdits ici).
- Limite connue : le jeton protège des processus/tiers, pas d'un
  attaquant local lisant la mémoire ou stdout ; loopback-only conservé.

## 3. Sandbox et liste blanche (P3)

- Vérifié : worker isolé V8, `resourceLimits` tas, timeout+kill,
  résultat capé, concurrence bornée, `op-worker.js` ne charge que
  `ops.js`, validateurs typés + bornés par op.
- **Ajouté** : test d'args hostiles via vrai worker (`__proto__`,
  `constructor.prototype`, fonctions, `require` déguisé) — refusés ou
  sans effet, `Object.prototype` intact (13/13 avec `guards`).
- Niveau honnête rappelé : pas de sandbox OS (`osSandbox:false`,
  `process.env` lisible dans le worker — aucun secret n'y transite).

## 4. Exécutant et STOP (P8)

- **Trouvé** : le frein n'était consulté qu'au placement ; un exécutant
  STOPpé exécutait encore les TASK reçues.
- **Corrigé** (`compute.js` `_handleTask`) : refus `exec-refused`
  (motif `frein`), sandbox jamais sollicité, rien renvoyé ; le
  coordinateur réaffecte après timeout (délai documenté). Test P8 vert.
- Thermique : machine à états conservée ; sondes indisponibles ici
  (WMI refusé dans ce sandbox) → proxy mémoire + Éco forcé, jamais de
  température inventée. Batterie : non mesurée, documentée.

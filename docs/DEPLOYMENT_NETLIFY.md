# Déploiement — démonstration statique Netlify et application locale

> Contrat de publication honnête pour le frontend `mesh-app/public`.
> Corrections de code réalisées par **Meta Muse**. L'audit et les
> opérations de déploiement relèvent de **Codex** ; aucun déploiement,
> aucune publication et aucune modification de paramètres système n'ont
> été effectués par Meta Muse pour ce contrat.

## 1. Deux modes, un seul critère : le jeton local

Le mode n'est **jamais** déduit du nom d'hôte.

| Critère | Démonstration statique (publique) | Application locale authentifiée |
|---|---|---|
| Jeton `window.__GENESIS_TOKEN__` | Placeholder, absent ou malformé | Jeton local valide (48 hex) injecté par `mesh-app/server.js` |
| Contrôles START/STOP, modes, job | Désactivés dans le HTML et dans `app.js` | Activés par `app.js` après validation du jeton |
| Appels `/api` | Aucun : zéro `fetch`, zéro `EventSource`, zéro polling | `fetch` + SSE `/api/events`, repli polling, en-tête `X-Genesis-Token` |
| Données affichées | Non mesurées : « — » | État réel renvoyé par le serveur de boucle locale |
| Bandeau visible | « Démonstration statique » | « Mode local authentifié » |

Aucun jeton public n'existe et aucune dérogation d'authentification
n'est prévue : sans jeton local valide, il n'y a rien à appeler.

## 2. Ce que Netlify publie — et ne publie pas

- `netlify.toml` publie `mesh-app/public` (HTML, CSS, JS, manifeste)
  et déclare `functions = "netlify/functions"`. Deux fonctions
  **informatives seulement** existent : `gateway` (JSON constant,
  `nodesLive: null`, aucun nœud réel) et `join` (consentement d'abord,
  aucun appairage effectué). Aucun proxy, aucune redirection `/api`,
  aucun worker de calcul, aucun secret.
- Le registre (`nt-registry`) reste une bibliothèque locale, non
  authentifiée et non connectée : il n'est **pas déployé comme
  service** sur Netlify.
- Sur Netlify, il n'y a ni `/api` de contrôle, ni serveur
  d'application, ni appareil connecté, ni calcul en direct. La page
  le déclare dès le haut et reste en démonstration statique.
- En-têtes : `no-store` pour `/` et `/index.html`, `no-cache,
  no-store, must-revalidate` pour `/sw.js`, afin d'éviter tout HTML ou
  service worker obsolète.

## 3. Application locale (inchangée dans son principe)

- Lancement par l'utilisateur sur sa machine : `node mesh-app/server.js`,
  puis ouverture de l'adresse de boucle locale affichée au terminal.
- Le serveur écoute en boucle locale uniquement, génère un jeton local
  par démarrage et l'injecte dans la **valeur JSON** du placeholder du
  script inline (`window.__GENESIS_TOKEN__` conserve son nom).
- Le HTML local est servi avec `Cache-Control: no-store` : il contient
  le jeton et ne doit jamais être mis en cache.
- Les POST sensibles exigent toujours Origin locale + jeton
  (`src/guards.js`) ; les erreurs des commandes locales sont capturées
  et affichées, sans rejet non capturé.
- STOP utilisateur reste prioritaire sur tout ordonnanceur.

## 4. Service worker et PWA — limites explicites

- `sw.js` (cache `snapmesh-public-v3`) ne met en cache que les
  ressources publiques sans jeton : `/styles.css`, `/app.js`,
  `/manifest.json` et les icones publiques. Il ne cache **jamais** le HTML ni `/api`, et purge
  à l'activation tout ancien cache `snapmesh-*`.
- Aucun mode hors-ligne n'est promis : la navigation n'est pas cachée.
- Installation PWA : équipement présent (manifeste, service worker,
  icônes 192/512 et apple-touch-icon), installation réelle sur
  appareil **NON VÉRIFIÉE** ; l'ajout à l'écran d'accueil reste
  possible selon le navigateur, sans promesse d'installation.

## 5. Limites scientifiques rappelées sur la page publique

- Run physique à 2 PC : **NON EXÉCUTÉ**.
- GPU / NPU : non démontrés sur ce périmètre ; un accélérateur absent
  est déclaré absent.
- Traversée NAT et relais : **[RECHERCHE]**.
- Thermique : non mesurée sur le poste de référence ; politique
  conservatrice, aucun plafonnement matériel promis.
- Vérification : un reçu signé prouve l'imputabilité d'un résultat,
  pas son exactitude ; le quorum n'est ni une preuve cryptographique
  complète, ni une protection anti-collusion.
- Aucune métrique n'est fabriquée pour la démonstration : les seules
  preuves citées sont le dépôt, `docs/M6_RESULTS.md` et les journaux
  bruts existants de `bench-logs/`, liés depuis la page.

## 6. Tests du contrat

- `mesh-app/test/frontend.test.js` exécute le vrai `public/app.js`
  dans `node:vm` (DOM minimal, espions `fetch`/`EventSource`/timers) :
  démo sans aucun appel réseau (placeholder et jeton absent), START
  puis STOP locaux authentifiés par en-tête, erreur réseau capturée.
- `mesh-app/test/api.test.js` vérifie sur le HTML réellement servi :
  syntaxe du script inline (`node:vm`), propriété
  `window.__GENESIS_TOKEN__` intacte avec la bonne valeur, et en-tête
  `Cache-Control: no-store`.
- `netlify/test/gateway.test.js` et `netlify/test/join.test.js`
  invoquent les vrais handlers des fonctions informatives (aucun
  appel réseau, `no-store` vérifié) ; ils ne prouvent pas un
  déploiement HTTP/HTTPS.
- Suites exécutées **séquentiellement** (voir `docs/TEST_STRATEGY.md`
  §6). Résultats exacts consignés dans `docs/JOURNAL.md`.

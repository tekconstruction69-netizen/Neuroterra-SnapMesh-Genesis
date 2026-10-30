# Publication vérifiée — 29 octobre 2026

**[FONCTIONNEL] : démonstration publique HTTPS, avec deux fonctions M7 informatives.** Aucun réseau de calcul public ni appareil distant n'est annoncé comme opérationnel.

## Publication

| Élément | Résultat vérifié |
|---|---|
| Site public | https://neuroterra-snapmesh-genesis.netlify.app |
| Dépôt public | https://github.com/tekconstruction69-netizen/Neuroterra-SnapMesh-Genesis |
| Projet Netlify réutilisé | `5b09fc44-e5bb-4b67-a19b-e0b58bceeee8` |
| Déploiement | `6ae3a70b3cbc804b972396a9` |
| Commit déployé | `dfe9724ab18776f6ead3da6bdd6bf9df3509cf7d` |
| Branche et source | `main`, dépôt GitHub relié au projet existant |
| État | API Netlify : `ready`, sans erreur ; tableau de bord : `Published` |
| Publication statique | `mesh-app/public`, sans commande de build nécessaire |
| Fonctions | `gateway`, `join` ; aucun worker permanent |
| Accès | Production publique ; prévisualisations réservées à l'équipe |

[Détail du déploiement Netlify](https://app.netlify.com/projects/neuroterra-snapmesh-genesis/deploys/6ae3a70b3cbc804b972396a9) · [Commit GitHub](https://github.com/tekconstruction69-netizen/Neuroterra-SnapMesh-Genesis/commit/dfe9724ab18776f6ead3da6bdd6bf9df3509cf7d).

## HTTPS, sécurité et contrôle en ligne

Vérification effectuée sans cookie ni authentification, le 29 octobre 2026 à 21 h 08, heure de Paris :

- Certificat TLS accepté par la validation standard : `*.netlify.app`, émetteur DigiCert, expiration le **19 mars 2027 à 23:59:59 UTC**. Aucun contournement de certificat.
- Page publique : HTTP 200. Les huit fichiers du frontend, dont les trois icônes, répondent en 200 et correspondent exactement au contenu du commit déployé.
- HTML : `Cache-Control: no-store`. Service worker : `no-cache,no-store,must-revalidate` ; HTML et API exclus de son cache.
- Les chemins testés `.env`, `.git/config`, serveur local, registre source, journal et `/api/state` / `/api/start` renvoient 404 sur Netlify. Aucun proxy vers les services locaux.
- Le scan local d'export passe. Le contrôle Netlify indique **284 fichiers examinés et aucun secret détecté**. Une clé éphémère régénérée par les tests a été conservée dans un répertoire temporaire ignoré, hors publication.
- Les autorisations de l'application GitHub Netlify sont limitées au dépôt désigné. L'administration Netlify conserve son authentification.
- Les étapes Netlify Initializing, Building, Deploying, Cleanup et Post-processing sont marquées Complete ; les quatre règles d'en-têtes sont appliquées sans erreur déclarée.

Preuve brute des requêtes, du certificat et des contenus servis : [deploy-live-20261029.json](../bench-logs/deploy-live-20261029.json). Ce journal et le présent rapport ont été créés après la publication et restent locaux.

## Tests

**41/41 tests réussis, suites exécutées séquentiellement.**

| Périmètre | Tests | Journal |
|---|---:|---|
| Frontend, gardes, API locale, calcul et STOP | 14/14 | [deploy-validation-20261029.log.txt](../bench-logs/deploy-validation-20261029.log.txt) |
| Registre local, NeuroCore, gateway et join | 27/27 | [deploy-m7-20261029.log.txt](../bench-logs/deploy-m7-20261029.log.txt) |

Les premiers essais avec restrictions réseau ont été bloqués ; un test du run Muse a été interrompu après blocage et n'est pas compté comme réussi. Les résultats ci-dessus proviennent des relances autorisées par Codex.

- Navigateur Work sans session Netlify : page ouverte, commandes publiques désactivées, métriques à « — », aucune erreur JavaScript récente détectée.
- Ordinateur : rendu inspecté. Mobile **[SIMULÉ]**, fenêtre de 390 × 844 pixels : rendu inspecté, aucun débordement horizontal. Aucun test physique d'iPhone n'est revendiqué.
- Liens GitHub et documentation présents dans la page, dépôt et fichiers cibles vérifiés.
- START/STOP locaux : contrôles API et comportement du vrai script frontend testés, avec consentement et jeton. Sur le site public, ils restent volontairement indisponibles.
- PWA : manifeste, service worker et icônes présents et servis. Installation réelle sur appareil **NON VÉRIFIÉE** ; aucun fonctionnement hors ligne promis.
- Scripts Windows d'installation et de lancement : syntaxe sans erreur, ASCII vérifié ; création de raccourcis et installation matérielle **NON EXÉCUTÉES**.

## Corrections effectuées

Le code a été corrigé par **Meta Muse** ; l'audit, la validation et les opérations de publication ont été réalisés par Codex.

1. Démonstration explicitement identifiée, présentation du problème, de NT-UCP, de NeuroCore et de la vérification, liens vers les preuves et limites visibles.
2. Commandes désactivées sans jeton local valide ; aucun appel applicatif `/api`, SSE ou polling en mode démonstration.
3. Injection du jeton local corrigée : son nom de propriété est préservé. HTML local non mis en cache ; erreurs de commande capturées.
4. Cache du service worker limité aux ressources publiques ; anciennes caches SnapMesh nettoyées.
5. Affirmations PWA/iPhone et M7 bornées aux preuves disponibles ; adresse LAN retirée du nouveau rapport M7.
6. Fonction `join` : corps JSON null et tableaux refusés proprement. Les fonctions ne connectent aucun appareil et n'exécutent aucun calcul.
7. Configuration Netlify cohérente, répertoire de publication contrôlé, liaison GitHub et accès public de production établis sur le projet existant.

## Problèmes restants et suite pour les deux PC

**[PRÉVU]** : coordinateur permanent de production, raccordement authentifié des workers et du registre, signatures/anti-rejeu du registre et synchronisation Supabase. Le registre M7 reste une bibliothèque locale non authentifiée, non exposée comme service.

`gateway` retourne 200 avec `nodesLive: null`. `join` retourne 405 en GET, 400 pour un corps invalide, 403 sans consentement et **501 même avec consentement** : l'appairage public n'est pas implémenté. Ces réponses ont été vérifiées en HTTPS.

**NON EXÉCUTÉ** : connexion physique des deux PC, installation sur iPhone, mesures thermiques, GPU/NPU distribués. NAT et passage entre réseaux distincts restent **[RECHERCHE]**. Aucun réglage de pare-feu ou système n'a été modifié.

Pour la prochaine preuve matérielle, utiliser le même commit et Node.js 24 sur les deux PC, sur un LAN privé, avec consentement des deux opérateurs. Suivre [M6_LAN_REPORT.md](M6_LAN_REPORT.md) :

1. Sur PC-B, lancer le rôle worker de `scripts/M5-TEST-LAN.ps1`, avec comme pair `<IP_PC_A>:49210`.
2. Sur PC-A, lancer le rôle coordinateur du même script. Ne pas ouvrir de port public.
3. Archiver les journaux des **deux** PC et vérifier `sessionVerified=true`, calcul exact, échange chiffré, reprise après panne et STOP. Sans ces preuves, le run reste NON EXÉCUTÉ.

Ces essais physiques ne sont pas remplacés par la publication Netlify.

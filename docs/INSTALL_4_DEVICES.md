# Installation et connexion des 4 appareils

> État au 2026-10-29 : scripts Windows verifies syntaxiquement (0 erreur, ASCII), mais creation des raccourcis et installation sur appareils NON EXECUTEES. Tests physiques a 4 appareils : NON EXECUTES. Le site public est une demonstration sans controle de worker.

## 1. Les deux PC Windows

Sur chaque PC (même dossier projet, Node 18+) :

```powershell
# Installation (raccourcis Bureau + Menu Démarrer, aucun service,
# aucun port public, aucun droit administrateur)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Install-Genesis.ps1
# Lancement : raccourci « Neuroterra Genesis » ou
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Start-Genesis.ps1
```

Dans l'interface locale (`http://127.0.0.1:48700/`, boucle uniquement) :
vérifier le NT-ID affiché, cocher le consentement, choisir le mode
Éco/Équilibré/Performance (budgets coopératifs, pas un plafonnement
matériel), puis START. STOP reste prioritaire. GPU : détecté et affiché
si présent, jamais plafonné ni promis. Thermique : politique
conservatrice faute de télémétrie fiable sous Node/Windows.

Jonction des deux PC (même LAN privé, consentement `OUI` des deux
opérateurs, pare-feu jamais modifié par les scripts) : worker sur PC-B
via `scripts\M6-WORKER.ps1 -Peer <IP-du-PC-coordinateur>:49210`, puis
coordinateur via `scripts\M5-TEST-LAN.ps1 -Role coordinateur`
(procédure complète : `docs/M6_TEST_PLAN.md`).

## 2. Les deux iPhone (Safari)

Ouvrir le site public dans Safari pour consulter la demonstration. L'ajout
via Partager puis Sur l'ecran d'accueil est une procedure indicative :
installation reelle sur iPhone NON VERIFIEE. Le manifeste, le service
worker et les icones sont presents ; aucun fonctionnement hors ligne
n'est promis.

Les commandes, le consentement et l'identite d'un worker sont desactives
sur le site public. Le serveur PC ecoute en boucle locale : il n'est pas
accessible a un iPhone via l'adresse LAN du PC. Aucune contribution iOS,
aucun arriere-plan permanent, plafond CPU ou releve thermique/batterie
ne sont demontres par cette publication.

## 3. Passerelle et deploiement Netlify

Le dépôt est prêt (`netlify.toml` : site `mesh-app/public` + fonctions
`netlify/functions`). Déploiement : connecter le dépôt GitHub à Netlify
(import du dépôt, aucun réglage à changer) ou `netlify deploy --prod`
après `netlify login`. La fonction `join` refuse sans consentement + NT-ID (403), puis retourne
501 meme avec consentement : aucun appairage n'est effectue. Aucun relais public n'est deploye,
la jonction réelle reste le LAN authentifié. Le lien d'installation
iPhone définitif est l'URL Netlify produite à cette étape — elle n'est
pas inventée ici.

## 4. Critères avant de dire « connecté »

Pair `sessionVerified=true` des deux côtés, job réel `done` et exact,
`[exec] chiffré=1` côté worker, journaux `bench-logs/` des deux PC
archivés. Sans ces journaux, l'appareil est « préparé », pas « testé ».

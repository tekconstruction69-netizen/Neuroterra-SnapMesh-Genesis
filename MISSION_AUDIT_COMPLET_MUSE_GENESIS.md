# MISSION MUSE — AUDIT COMPLET ET RECONCILIATION DE NEUROTERRA SNAPMESH GENESIS

## Règle absolue

Avant tout nouveau développement, tu réalises un audit **en lecture seule d'abord** de l'ensemble du dossier de travail `Neuroterra-SnapMesh-Genesis` ; aucune réécriture, aucun déploiement, aucun push, aucune suppression, aucun changement système, aucune installation privilégiée et aucun appel à des services payants sans accord explicite. Toutes les communications sont en français. Ne jamais déclarer fonctionnel un élément non testé. Étiqueter tests injectés/émulés.

## Contexte de la mission

De longs prompts ont été collés dans Muse Code / PowerShell ; leur réception complète n'a pas été confirmée. Nous devons distinguer : exigences formulées, exigences présentes dans les fichiers de spécification, code réellement existant, tests exécutés et fonctionnalités absentes. Ne présume pas que des prompts ont été coupés uniquement parce que l'affichage est « output capped ». Cherche plutôt des preuves.

## A. Intégrité des sources et du processus

1. Confirmer racine et branche Git, `git status --short`, HEAD, `git remote -v`, `git fetch` seulement si autorisé/accès, et comparaison `origin/main` sans écriture dans le dépôt ni perte des modifications.
2. Inventorier tous les fichiers suivis, non suivis et ignorés ; créer un rapport `AUDIT_INVENTORY` non sensible sans publier.
3. Comparer la copie locale au commit public `dfe9724ab18776f6ead3da6bdd6bf9df3509cf7d` du 29/10/2026 ; noter explicitement `mesh-safety/src/sysinfo.js`, frontend, `mesh-app/server.js`, nouvelles pages/réglages, éventuel prototype Rust.
4. Inventorier les sessions et prompts conservés, `docs/JOURNAL.md`, `PROGRESS.md`, AGENTS.md et fichiers de spécifications. Ne pas accéder aux secrets des sessions.
5. Vérifier la taille, les lignes et SHA-256 de ce fichier de mission lu ; citer ces trois valeurs dans le premier rapport.

## B. Matrice globale des exigences (pas de promesse)

Créer `docs/AUDIT_REQUIREMENTS_MATRIX.md` avec identifiant, exigence, fichier source, preuve de test, statut EXACT parmi : IMPLEMENTÉ_TESTÉ_LOCAL, IMPLEMENTÉ_NON_TESTÉ, PARTIEL, ABSENT, PLATEFORME_INCOMPATIBLE, RECHERCHE.

Inclure chaque catégorie : application UX, onboarding, analyse matériel, NT-ID, signatures, discovery LAN, Bluetooth, BLE, Wi-Fi Direct, WLAN, PWA iOS/Android, worker natif, START/STOP, batterie, thermique, limites CPU/RAM/GPU/VRAM, sandbox, NT-UCP, NT-ADAPT, NT-COMPAT, NT-FUSION, NT-Flux, NeuroCore autonome sans Muse au runtime, transport et encryption, quorum et reçus, fragmentation/agrégation, modèles ONNX, orchestration GPU/CPU/NPU, registre global, NAT/relay, Supabase, Netlify, GitHub, confidentialité, sécurité API et packaging. Distinguer code nouveau construit pendant le hackathon et travail historique documenté.

## C. Audit sécurité — priorité absolue

1. Examiner `mesh-compute/src/sandbox.js`: `shutdown()` doit véritablement interrompre les Worker threads et attendre leur terminaison, pas seulement rejeter les promesses. Tester STOP au milieu d'une charge CPU, comparer nombre de threads/processus et charge avant/après, forcer timeouts et annulations.
2. Examiner `mesh-safety/src/controller.js`: `setTargets()` doit valider les nombres finis, types, plages, limites positives, champs manquants, `NaN`, `Infinity`, chaînes, null, valeurs extrêmes. Vérifier que la demande de budget applique vraiment la limite.
3. Revoir sondes batterie/thermique; sur Windows une sonde fiable peut être indisponible. Ne jamais afficher de fausse température ou garantir un arrêt matériel non démontré.
4. Vérifier les limites mémoire V8/OS (pas de prétention à un vrai sandbox OS), arrêt du job, réseau, reprises, exécution de code whitelistée.
5. Auditer origin/CSRF, authentification locale, tokens, logs de secrets, historique Git, injections API, `max-body`, évasions de chemins de fichiers statiques, rate limits, dépendances et mises à jour; ne jamais tester sur des IP externes sans accord.
6. Vérifier signature et empreinte NT-ID, cohérence du registre, anti-rejeu, quorums et résistance aux nœuds malveillants; ne pas assimiler quorum à preuve de calcul correct.

## D. Tests reproductibles

Exécuter séquentiellement les tests unitaires, intégration et benchmarks déjà présents sans modifier les configurations réseau du PC. Conserver un journal brut daté par suite et code de sortie. Rejouer au minimum :
- Tests mesh-net, mesh-compute, mesh-safety, neurocore, nt-compat, nt-ucp, nt-pq, nt-fusion, nt-flux, nt-registry et mesh-app.
- Tests frontend en deux modes : démo statique sans jeton / frontend local authentifié.
- Test batterie inconnue, sonde thermique absente, entrée API invalide, STOP pendant calcul, START sans pair, arrêt répété, reprise après panne.
- Séparer tests même-hôte, simulation et tests physiques. Ne jamais présenter le test même-hôte comme preuve 2 PC.
- Tests 2 PC et 2 réseaux = NON EXÉCUTÉS jusqu'à fourniture des deux vrais journaux par les opérateurs.

## E. Déploiement & UX

Vérifier que `netlify.toml` publie seulement `mesh-app/public`, et que `netlify/functions/gateway.js` et `join.js` sont informatives ; aucun calcul distant public ne doit être annoncé. Vérifier les PWA, cache, permissions, stockage, safe areas, responsive, nav Accueil/Vision/Mon appareil, réglages et suppression des onglets inutiles. Identifier ce qui appartient encore au travail local non poussé.

## F. Conformité hackathon

Examiner AGENTS.md : « Utiliser Meta Muse pour le développement » est notre règle de projet. Ne pas inventer de clause officielle disant que les autres assistants sont interdits. Demander au propriétaire le règlement officiel accepté si inaccessible, et maintenir Muse comme auteur des corrections en attendant. Consigner précisément l'usage de Muse et tout autre outil d'audit dans la traçabilité. Ne pas réécrire les preuves historiques ni la date de création du code.

## G. Livrables

1. `docs/AUDIT_REQUIREMENTS_MATRIX.md` : matrice complète REQ → code → preuve.
2. `docs/AUDIT_SECURITY_20261029.md` : findings par gravité CRITIQUE/ÉLEVÉ/MOYEN/FAIBLE, emplacement exact et scénario reproductible.
3. `docs/AUDIT_LOCAL_VS_GITHUB.md` : différences local/main, risque de publication, fichiers non suivis.
4. `docs/AUDIT_TEST_RESULTS.md` : commandes exécutées, versions des outils, logs bruts, résultat de chaque suite et statut exécuté/non exécuté.
5. `docs/RECOVERY_PLAN.md` : correction par étapes P0, P1, P2, chacune bornée à un petit changement testé, dépendances, risques, critères d'acceptation.
6. Synthèse courte en français : ce qui fonctionne réellement, manque, ne peut pas fonctionner par navigateur, et pourrait être testé physiquement.

Aucune correction de code avant remise des rapports d'audit et décision du propriétaire. Pour une éventuelle correction P0 urgente, présenter le diff prévu et demander validation. Aucun push, aucune publication Netlify et aucun changement Windows à ce stade.

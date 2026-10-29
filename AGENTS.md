# AGENTS.md — Neuroterra SnapMesh Genesis

> Règles obligatoires pour tout agent (humain ou IA) travaillant sur ce
> dépôt pendant le Meta Global AI Developer Hackathon 2026.

## 1. Langue et moteur

- Répondre en **français** dans toutes les communications visibles.
- Utiliser **Meta Muse** pour le développement du projet.

## 2. Honnêteté technique (non négociable)

- Ne jamais déclarer une fonctionnalité comme fonctionnelle sans l'avoir
  **testée** ; marquer **[FONCTIONNEL]** / **[PRÉVU]** / **[RECHERCHE]**.
- Ne jamais inventer de mesures, de benchmarks ni d'appareils connectés ;
  tout chiffre cite son protocole et son journal brut.
- Le matériel émulé est toujours étiqueté « émulé ».

## 3. Qualité du code

- Code modulaire, documenté et testable (un module = un dossier, API
  documentée, dépendances unidirectionnelles — voir `docs/ARCHITECTURE.md`).
- Chaque modification suit `docs/TEST_STRATEGY.md` (tests du module + gates
  du jalon en cours).

## 4. Sécurité et publication

- Ne jamais exposer de clés API : variables d'environnement + `.env.example`,
  jamais de secret dans le dépôt.
- Obtenir une **approbation explicite** avant tout déploiement, toute
  publication ou toute modification de paramètres système.
- Ne rien publier sur GitHub sans approbation ; respecter l'exigence de
  dépôt public et de travaux nouveaux uniquement (voir skill
  `hackathon-compliance`).

## 5. Sécurité matérielle et application (M2-SAFETY)

- Ne jamais présenter une simulation comme une protection validée :
  tests à télémétrie injectée = **[SIMULÉ]**, mesures machine = **[MATÉRIEL]**.
- Ne jamais présenter un % affiché comme plafonnement matériel sans preuve.
- STOP utilisateur prioritaire sur tout ordonnanceur, y compris Muse.
- Aucune promesse de revenu, aucun calcul sans preuve, messages en français.
- Ne pas annoncer arrière-plan, thermique ou plafonnement CPU par
  plateforme sans vérifier la matrice (`mesh-safety/src/platforms.js`).

## 6. NeuroCore autonome et post-quantique

- Conversions de formats EXPLICITES uniquement (nœud `cast`) : jamais
  de changement silencieux fp32/int8 ; erreurs de quantification
  bornées et testées.
- Backends détectés, jamais inventés : toute matrice de compatibilité
  vient d'une sonde locale (`nt-compat`), GPU/NPU absents = absents.
- PQ : primitives éprouvées (`node:crypto`) uniquement, jamais de
  crypto maison ; interdiction de revendiquer « quantum-safe » sans
  audit indépendant ; Ed25519 reste le défaut (coexistence par `kind`).
- Plans IA (Muse) : toujours re-validés par l'arbitre déterministe
  avant exécution ; repli local signalé si indisponible.
- NeuroCore (`neurocore/`) : AUCUN appel Muse/fetch au runtime (testé
  avec fetch espion) ; optionnel et désactivé par défaut côté réseau ;
  aucune clé API requise sur les appareils.
- Apprentissage : EWMA bornée, que des durées/comptes ; la validation
  déterministe prime toujours sur l'adaptation.

## 7. Scripts de terrain M5 (hors sandbox)

- Scripts `scripts/M5-*.ps1` : ASCII strict, Windows PowerShell 5.1 (pas de
  ternaire `?:`, pas de `&&`), `#Requires -Version 5.1`, lecture seule ou
  processus nettoyés, pare-feu JAMAIS modifié par un script.
- Codes de sortie : 0 = réussi, 1 = échec fonctionnel, 2 = environnement
  bloqué (EACCES/sandbox/sans consentement) — jamais un échec déguisé.
- Valider la syntaxe via `PSParser` avant livraison ; tout résultat sans
  journal `bench-logs/m5-*` est NON EXÉCUTÉ, pas échoué.

## 8. Traçabilité du hackathon

- Consigner chaque session de travail dans `docs/JOURNAL.md`
  (date, auteur, fait, tests, statut des jalons).
- Mettre à jour le statut **[FONCTIONNEL]** / **[PRÉVU]** / **[RECHERCHE]**
  des docs dès qu'un test le justifie.

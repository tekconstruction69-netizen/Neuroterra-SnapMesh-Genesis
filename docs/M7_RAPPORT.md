# M7 — Neuroterra Global Mesh : rapport

> Règle de ce rapport : seuls les tests réellement exécutés et
> journalisés sont rapportés comme tels ; les autres sont marqués
> historiques déclarés (voir §4). État avant déploiement : rien n'a
> été publié par cette correction ; la publication M7 (après audit
> et validation) est autorisée à Codex.
> Ce poste : adresse LAN locale non reproduite dans ce rapport.

## 1. Audit des modules existants (lu et testé, pas réécrit)

- `mesh-net` : transport TCP, découverte LAN, heartbeats, sessions
  X25519 + AES-256-GCM, relais 1-saut — **[FONCTIONNEL même hôte]**.
  C'est le service de coordination de fait : un processus Node permanent,
  indépendant de Netlify, déjà existant. Aucun nouveau coordinateur
  n'a été créé ; le chaînon manquant était le registre global (ci-dessous).
- `mesh-compute` : ops whitelistées, sandbox bornée, quorum, reprise —
  **[FONCTIONNEL même hôte]** ; réaffectation + anti-doublon (idempotence,
  empreintes de résultat) déjà prouvés en local.
- `nt-ucp`/`nt-pq` : CERT signé, NEGOTIATE anti-rejeu, hybride PQ —
  inchangés. `nt-compat`/`nt-fusion` : sondes et graphe typé — inchangés.
- `neurocore` + NT-ADAPT/2 : sélection (compatibilité, mémoire, perfs
  mesurées, liens, fiabilité, confidentialité) et refus motivé du
  distribué — **[FONCTIONNEL]** (16/16 ce jour).
- `mesh-app/public` : tableau de bord distinguant déjà démonstration
  statique et données réelles (bandeau de mode, contrôles désactivés
  sans serveur local authentifié) — conservé tel quel.

## 2. Plan de migration minimal (par ordre)

1. Registre global persistant (NT-ID + empreinte déclarée des
   capacités, formats seulement — voir §3 pour le périmètre exact
   du rejet d'adresse ; aucune promesse d'absence universelle d'IP).
2. Passerelle Netlify courte (fonctions sans état), réponse
   informative seulement. Branchement en lecture du registre :
   **[PRÉVU]**, non implémenté — `nt-registry` est à ce jour une
   bibliothèque locale non authentifiée, **non reliée** à la
   passerelle.
3. Coordinateur permanent = `mesh-net` existant, joint au registre par
   heartbeats sortants authentifiés (branchement **[PRÉVU]**).
4. Découverte régionale (champ `region`) + groupes d'entreprise
   (`groupId`, politiques de contribution) au registre.
5. Stratégie de communication inchangée : LAN → P2P direct authentifié →
   relais 1-saut → cloud (repli, clé par environnement, non appelé).
6. Validation physique 2 PC, puis 2 réseaux, avant tout discours mondial.

## 3. Implémenté ce jour

- **`nt-registry/` [historique déclaré, local — en attente de
  rejouage, voir §4]** : bibliothèque locale **non authentifiée**,
  **non reliée à la passerelle**. `GlobalRegistry` persistante
  (JSON atomique) : inscription avec **validation de format
  seulement** (`ntId` : format d'empreinte ; `capsHash` : format
  sha256 hexadécimal d'une empreinte **déclarée**), région, groupe,
  politique CPU/mémoire/acceptation distante, heartbeat, expiration
  automatique (TTL 30 s par défaut), purge, vues vivantes filtrées.
  Capacités **déclarées** : aucune signature, aucune preuve de
  propriété de clé et aucun manifeste vérifié ne sont contrôlés.
  Rejet d'adresse **limité** : seuls les champs d'adresse directs
  `ip`/`ipAddress`/`address`/`host`/`privateIp` (insensible à la
  casse) sont rejetés ; `region` et `groupId` sont des chaînes
  libres non filtrées — **aucune promesse d'absence universelle
  d'IP** (une IP écrite en texte libre dans `region`/`groupId`
  ne serait pas rejetée). Aucun adaptateur Supabase implémenté :
  `backendFromEnv` détecte seulement la présence d'une
  configuration (`SUPABASE_URL`/`SUPABASE_ANON_KEY`), **sans aucun
  appel réseau quel que soit le résultat** ; synchronisation
  **[PRÉVU]** (schéma SQL + politiques RLS à revoir avant tout appel).
- **`netlify/functions/gateway.js` [historique déclaré, local —
  en attente de rejouage, voir §4]** : fonction courte sans secret
  ni état, **non reliée au registre** ; répond `nodesLive: null`
  avec motif tant qu'aucun coordinateur authentifié n'est branché
  — aucun nœud inventé. L'invocation locale de `handler()` retourne
  un objet avec `statusCode: 200` ; **ce n'est pas encore une preuve
  HTTP/HTTPS déployée**. `netlify.toml` déclare le dossier de
  fonctions ; le site reste le seul dossier `mesh-app/public`, sans
  worker, port ni interface d'admin.

## 4. Tests historiques déclarés (en attente de rejouage)

Les tests ci-dessous existent, mais **aucun journal brut M7 n'a été
retrouvé** à ce jour : leurs résultats sont donc des **résultats
historiques déclarés**, non re-vérifiés par cette correction.
Ils restent **en attente de rejouage avec journal par Codex**
(journal brut archivé exigé avant tout statut [FONCTIONNEL]).

- `nt-registry` : **3/3 [historique déclaré]** (inscription/heartbeat/
  expiration/purge, rejet des champs d'adresse directs et vues
  filtrées, persistance relue, backend par env).
  Premier run déclaré : échec `mkdtemp EPERM` du sandbox (dossier temp
  système), corrigé en dossier de test local — consigné, pas masqué.
- `neurocore` : **16/16 [historique déclaré]** (dont NT-ADAPT 2 :
  cache, confidentialité, refus du distribué, autonomie fetch-espion).
- Passerelle invoquée localement **[historique déclaré]** :
  `handler()` retourne `statusCode: 200`, portée démo explicite ;
  ce n'est pas une preuve HTTP/HTTPS déployée.
- Contrôle secrets **[historique déclaré]** : `check-export-public.js`
  exit 0 après suppression d'une clé d'identité de test régénérable
  (`mesh-app/test/data-app-exec.key`, couverte par `.gitignore`,
  jamais commitée).

## 5. Première validation obligatoire : NON EXÉCUTÉE

Deux PC physiques (même réseau, puis deux Internets) avec tâche IA
réelle : **aucun second PC accessible ou configuré** (`SNAPMESH_PEER`/
`M6_PC2_HOST` absents), sockets `listen` interdits dans le sandbox
(EACCES), consentement du second opérateur requis. Ni latence, ni
débit, ni reconnexion inter-machines ne sont donc rapportés.
Procédure, critères et commandes : `docs/M6_TEST_PLAN.md` et
`docs/M6_LAN_REPORT.md` (worker `scripts/M6-WORKER.ps1` prêt).

### Mise en scène du run (2026-10-29, après première rédaction)

L'utilisateur a confirmé en session : second PC prêt sur le même LAN,
périmètre « même LAN d'abord », consentement des deux opérateurs.
Préflight de ce poste (journal `bench-logs/m5-preflight-20261029-204953.log`) :
dépendances, ONNX Runtime 1.31.1 et ports libres OK ; deux KO attendus et
bornés au sandbox (`listen` bloqué EACCES, inventaire interfaces restreint).
Le lancement réel doit donc être fait **hors sandbox par les opérateurs**
dans l'ordre : worker PC-B (`scripts/M6-WORKER.ps1 -Peer <IP-LAN-PC-A>:49210`,
adresse LAN de ce poste à renseigner hors rapport), puis coordinateur PC-A
(`scripts/M5-TEST-LAN.ps1 -Role coordinateur`). À archiver des deux côtés :
`bench-logs/m6-worker-*.log` (PC-B) et `bench-logs/m5-lan-coordinateur-*`
(PC-A), lignes `/status` avec `sessionVerified=true`, verdict du job et
`[exec] chiffré=1`. **Tant que ces journaux ne sont pas revenus, le run
reste NON EXÉCUTÉ** ; l'étape « deux réseaux Internet » ne commencera
qu'après un run LAN vert (relais/NAT toujours [PRÉVU]/[RECHERCHE]).

## 6. Limites et risques

La persistance locale (fichier JSON, reprise, replan) **n'est pas
une preuve d'absence de point unique de défaillance** : sur un poste,
le fichier et le processus restent uniques ; au niveau mondial, le
registre et le coordinateur restent des points de coordination
(jamais de vérité d'exécution : reçus + quorum restent la référence).
`nt-registry` est une bibliothèque locale non authentifiée, non
reliée à la passerelle : aucune authentification n'y est implémentée.
Régions = champ de registre, pas encore de fédération. NAT : **[RECHERCHE]** non implémenté.
Supabase, cloud, GPU/NPU : **[PRÉVU]**, non démontrés. Sécurité conservée :
signatures NT, TLS de plateforme (Netlify/GitHub), autorisations par
consentement, isolation sandbox, bornes CPU/mémoire, arrêt thermique
seulement si télémétrie réelle, aucun code distant arbitraire.

## 7. Prochaines étapes (état avant déploiement)

1. Run physique 2 PC (même LAN) avec journaux des deux côtés.
2. Brancher les heartbeats du coordinateur au registre (signés NT-ID).
3. Revoir le schéma Supabase + RLS, puis seulement activer la sync.
4. Run via deux réseaux différents ; mesurer ; décider du relais/NAT.
5. État avant déploiement : **rien n'a été publié par cette
   correction** (aucun commit, push ni déploiement effectués ici).
   La publication M7, après audit et validation (dont le rejouage
   avec journal du §4), est **autorisée à Codex**.

## Rejeu de validation avant publication (Codex, 2026-10-29)

[FONCTIONNEL, local] : registre 3/3, NeuroCore 16/16, gateway 2/2, join 6/6, suites sequentielles. Journal brut : [deploy-m7-20261029.log.txt](../bench-logs/deploy-m7-20261029.log.txt). Les tests de fonctions invoquent les handlers ; la preuve HTTPS reste a effectuer apres deploiement. Aucun appairage public, aucune authentification du registre ni synchronisation Supabase ne sont demontres par ces tests.

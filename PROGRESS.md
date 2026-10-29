# Suivi d'avancement — Neuroterra SnapMesh Genesis

> Mis à jour à chaque jalon. Statuts : ✅ testé · 🟡 en cours · ⬜ prévu.
> Détail des preuves : journaux bruts dans `bench-logs/` (copies
> versionnables `validation-*.log.txt`, sans secret).

| Jalon | Contenu | Statut | Preuve |
|---|---|---|---|
| M0 | Fondation (specs, skills, règles) | ✅ | 6/6 skills `valid:true` |
| M1 | Réseau : transport, découverte, identité, heartbeats, registre, robustesse trames | ✅ même hôte | `validation-m1-20261026b.log.txt` : **37/37** (18 historiques + 6 session + 5 transport + 8 intégration ; historique 18/18 conservé dans `validation-m1-20261026.log.txt`) ; inter-machines : procédure prête (`scripts/TEST-LAN-DEUX-PC.md`), NON EXÉCUTÉ |
| NT-ID | Défi de session par rattachement, anti-rejeu (nonce signé + cache 500), révocation immédiate, renouvellement par ancienne clé | ✅ même hôte | inclus dans M1 37/37 ; révocation/renouvellement couverts par tests historiques |
| NT-CAP | Profil versionné signé (CPU/GPU/NPU/RAM/transports), RTT + RAM libre live via HEARTBEAT, ordonnanceur compatible v1+v2 | ✅ même hôte | inclus dans M1/M2 ; `bad-caps` ignoré, GPU/NPU jamais inventés |
| §3 Transport | Sessions chiffrées X25519 éphémère + AES-256-GCM (TASK/RESULT), relais minimal store-forward 1-saut | ✅ même hôte | `validation-transport-20261026.log.txt` : **5/5** transport + **1/1** e2e chiffré via proxy (secret absent du fil) ; fail-first : test ÉCHEC en clair (prouvé), SUCCÈS chiffré |
| §4 Sandbox | Worker `worker_threads` par tâche : timeout+kill, tas capé, résultat capé, concurrence bornée, cancel, refus silencieux + reprise | ✅ même hôte | `validation-sandbox-20261026.log.txt` : **10/10** unit + **1/1** e2e (timeout distant 1 ms → reprise, 2/2 done) ; fail-first câblage prouvé (9/10 avant, 10/10 après) ; doc honnête `docs/SANDBOX.md` (`osSandbox:false`, env lisible) |
| M2 | Calcul distribué : ops sûres, file stricte + persistée, ordonnanceurs, TASK/RESULT, quorum, reprise | ✅ même hôte | `validation-m2-20261026f.log.txt` : **63/63** (58 historiques + 3 reçus + 2 e2e preuve ; quorum 3/3, fraude écartée, kill synchronisé, reprise après kill coordinateur) ; M1 37/37, safety 15/15, app 4/4 rejoués verts |
| §7 Vérificateur | Reçus Ed25519 (liaison charge↔résultat↔exécutant), empreintes sha256 E/S, rejet pré-vote, faisceau job + réponse finale vérifiable | ✅ même hôte | `validation-verify-20261026.log.txt` : **3/3** unit + **2/2** e2e (faisceau re-vérifié hors-ligne ; menteur signé → job `failed` malgré reçus valides) ; doc `docs/VERIFICATION.md` (reçu ≠ exactitude) |
| §8 Safety câblée | Frein contrôleur sur tout placement (`brake`, Muse inclus, reprises comprises) + `capsExtra` live + STOP annule l'en-vol local | ✅ même hôte | fail-first prouvé (placée malgré le frein → refusée) ; `validation-app89-20261026.log.txt` |
| §9 App Genesis | Profil NT-ID, NT-CAP soi+pairs, graphe temps réel, `POST /api/job` → DAG → réponse vérifiée (409 sans contribution) | ✅ même hôte | `validation-safety-app-20261026g.log.txt` : **6/6** API (4 historiques + 2 job : 409 STOPPED + bout-en-bout `[6765,75025]` + faisceau) ; M2 64/64, M1 37/37, safety 15/15 rejoués verts |
| §5 Fragmenter | DAG v1 validé (id/deps/$ref∈deps/minRes/timeout/expiry/validation/merge nommé), vagues parallèles via submit(), presets matmul-chaîne/batch/transform | ✅ même hôte | `validation-frag-20261026.log.txt` : **9/9** unit + **3/3** e2e (chaîne I×A×B exacte, wordcount recollé exact, batch [6765,75025,832040], tous répartis sur 2 nœuds) ; fail-first `submitDag` prouvé |
| §6 Orchestrateur | Adaptateur Muse (contrats v1, prompt strict, budgets, timeouts) + arbitre déterministe + heuristique validée + repli round-robin ; comparatif 4 schedulers | ✅ même hôte (sauf appel live) | `validation-muse-20261026.log.txt` : **10/10** unit + **1/1** comparatif (local/round-robin/capacity/muse : 2/2 done partout, makespans 43–55 ms rapportés sans allégation) ; appel distant live [PRÉVU-live] (aucune clé ici) |
| M2-SAFETY | App START/STOP + contrôleur matériel (budgets, thermique, STOP prioritaire, déconnexion réseau) | ✅ même hôte | `mesh-safety` 15/15, `mesh-app` 4/4 API, 9 cas couverts (`docs/SAFETY_TEST_REPORT.md`) ; PWA locale non ouverte en navigateur ici |
| M3 | Ordonnanceur Muse + arbitre + repli | ⬜ non commencé | contrats figés : `docs/MUSE_CONTRACTS.md` |
| M4 | Sécurité (mTLS, DPAPI, exclusion, durcissement TOFU), benchmarks B0/B1/B2 | 🟡 partiel | Benchmarks ✅ (`docs/BENCHMARKS.md`, 100/100, 5 configs, journal brut) ; restent : mTLS, DPAPI, exclusion auto |
| §10 Bilan | Benchmarks + démo bout-en-bout + conformité + bilan | ✅ même hôte | `validation-bench-20261026.log.txt` ; `validation-demo-20261026.log.txt` (DEMO REUSSIE) ; `docs/COMPLIANCE.md` (aucune publication, aucun secret, git à confirmer par le propriétaire) |
| M5 | Validation physique + orchestration réelle + démo 3 min : 4 scripts terrain + pilote NeuroCore + 6 docs | 🔴 j1 en échec terrain → 3 causes prouvées+corrigées, relance requise | (1) pendaison retry, (2) guillemets argv → --job-params-file + fail-fast, (3) BOM UTF-8 PS5.1 → écriture sans BOM + readJsonFile tolerant ; régressions 2/2 + 7/7 ; combiné 124/124 |
| M6 | Démonstration LAN 2 PC : procédure + scripts durcis + rapport | 🟡 procédure prête, run 2-PC NON EXÉCUTÉ | audit sans duplication ; log Caps ; preflight intégré ; bornes explicites ; preuves sessionVerified/chiffré=1 ; combiné 124/124 (validation-m6) |
| M4 | Réseau physique prêt + ORT/DML réels + pont NeuroCore→M2 + STOP mesuré + 6 docs | ✅ même hôte (sauf 2-PC/LAN) | combiné **115/115** (`validation-m4-20261026.log.txt`) ; ORT 1.31.1 (cpu+dml exacts, cuda absent) ; `bench-m4-backends` 5 reps ; scanner export vert (testé ±) ; démo/2-PC prêts hors sandbox |
| NeuroCore | Orchestrateur autonome (COST+LEARN+RECOMPOSE+FLOW+SURVIVE), zéro Muse au runtime, benchmarks A-E | ✅ même hôte (sauf 2-PC/LAN) | `neurocore` 7/7, combiné **109/109** (`validation-neurocore-20261026.log.txt`) ; `scripts/bench-neurocore.js` 5 reps (`neurocore-abcde-20261026.json`) ; 6 docs `NEUROCORE_*.md` ; Muse live et 2-PC NON exécutés |
| Correctifs audit | Clés éphémères, API durcie (401/403/413), sandbox prouvé, STOP exécutant, Muse connecté+journalisé, PQ composé, démo enrichie | ✅ même hôte (sauf sockets/2-PC) | combiné **102/102** (`validation-corrections-20261026.log.txt`) ; `check-export-public.js` exit 0 ; doc `SECURITY_AUDIT.md` ; démo/binaire 2-PC prêts hors sandbox ; Muse live et LAN NON exécutés |
| NT-UCP | CERT signé + NEGOTIATE authentifiée + PoC hétérogène 2 backends + surcoûts ventilés | ✅ même hôte (sauf TCP/LAN) | `nt-ucp` 4/4, combiné **75/75** (`validation-ntucp-20261026.log.txt`) ; `scripts/bench-ntucp.js` (`ntucp-poc-20261026.json`) ; doc `NT_UCP_SPEC.md` ; M2 32/32 revérifié avant |
| NT-FUSION | Graphe typé + NT-COMPAT + Muse planner + NT-PQ hybride + registre vérifiable + expériences A-E | ✅ même hôte (sauf TCP/LAN/GPU) | `nt-compat` 5/5, `nt-fusion` 7/7, `nt-pq` 6/6 ; run combiné **71/71** (`validation-ntfusion-20261026.log.txt`) ; `scripts/bench-ntfusion.js` 5 reps (`bench-logs/ntfusion-abcde-20261026.json`) ; docs `NT_FUSION_SPEC/COMPAT_MATRIX/PQ_SECURITY/FUSION_EXPERIMENTS/PRIOR_ART_AND_NOVELTY.md` ; Muse live, LAN, GPU/NPU NON démontrés |
| NT-Flux | Compression adaptative + dedup (mesh-flux 0 dép., opt-in), contrat Muse, benchmarks A/B/C/D | ✅ même hôte (sauf TCP) | `mesh-flux` 7/7, `flux-wire` 3/3 (fil JSON réel, reçus Ed25519, verdicts exacts), `fragments` 11/11, M1/M2 32/32 ; `scripts/bench-ntflux.js` 5 reps (rapport `bench-logs/ntflux-abcd-20261026.json`) ; docs `NT_FLUX_{ARCHITECTURE,SECURITY,BENCHMARKS}.md` ; e2e TCP 2 processus prêt (`flux-e2e`, ports 48411/48412), à exécuter hors sandbox ; LAN 2-PC NON EXÉCUTÉ ; appel Muse live NON EXÉCUTÉ |

## Limitations transverses connues (toutes documentées)

- Validations réseau et calcul : **même ordinateur uniquement** (loopback).
  Plusieurs processus prouvent une intégration locale, pas un réseau
  multi-appareils.
- Clés : mode `0o600` inopérant sur Windows (ACL observées) → DPAPI en M4.
- Quorum 2/3 : détecte fautes aléatoires + menteur isolé ; **ni preuve
  cryptographique d'exactitude, ni résistance aux collusions**.
- Menteur : résultat écarté + pair signalé ; **exclusion réseau [PRÉVU]**.
- Connexions : TOFU (tout pair peut rejoindre) ; mode « confiance » en M4.
- Anti-rejeu : nonce signé par enveloppe + cache 500 ✅ (§ NT-ID) ; seq heartbeat + fenêtre ts conservés.
- Chiffrement : X25519 éphémère + AES-256-GCM ✅ (§3, même hôte) ; clés renégociées par session, révoquées avec l'identité ; mTLS [PRÉVU] M4.
- Relais : forward 1-saut TASK/RESULT signé, TTL, pas de routage multi-sauts ; relais chiffré bout-en-bout [PRÉVU].
- Suites de tests : exécution **séquentielle** obligatoire (voir
  `docs/TEST_STRATEGY.md` §6) ; runs parallèles invalidés le 2026-10-26.

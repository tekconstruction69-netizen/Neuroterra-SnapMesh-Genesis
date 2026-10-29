# 01 — État de l'art et audit

## 1. Audit Genesis (code lu, pas seulement documenté)

| Composant | Réellement exécuté [FONCTIONNEL] | Simulé / compté | Documenté non implémenté / absent |
|---|---|---|---|
| NT-UCP (`nt-ucp/`) | NT-CERT signé rejetant le falsifié, NT-NEGOTIATE 2 phases + anti-rejeu, PoC 2 profils | Fil = copies JSON (pas de sockets dans le PoC) | Attestation par épreuve d'exécution : **[PRÉVU]** explicite (`NT_UCP_SPEC.md` §4 : « un manifeste menteur passe l'arbitrage ») |
| NT-COMPAT (`nt-compat/`) | Détection honnête (JS fp64/fp32/int8 mesurés), `checkAssignment` motivé, tenseurs réels, ORT 1.31.1 cpu+dml mesurés (cuda absent) | — | GPU/NPU toujours `available:false` (`caps.js`, `backends.js` : `acceleratedImplemented: []`) ; backend int8 **sans champ `flops`** → coût par défaut 1 Mflops conservateur |
| NT-FUSION (`nt-fusion/`) | Graphe typé 4 kinds/2D, `cast` explicite obligatoire, exécution réelle, greedy + arbitre | Transferts comptés dans `execute.js` (0 si même worker) | Tolérance par nœud dans l'IR : absente ; kinds conv/activations : absents |
| NeuroCore (`neurocore/`) | COST (calcul+transfert+conversion+codec+fiabilité), LEARN EWMA bornée, FLOW autonome (fetch espion testé), replan panne, frein | Réseau du bench A–E : fil compté | `chooseCut/chooseSplit` (RECOMPOSE) **jamais appelés** par `flow.js` (orphelins, testés seuls) ; incertitude calculée (`cost.js:61`) **jamais consommée** par `prefer()` ; vérification finale = égalité JSON binaire (`flow.js`, `a === b`) |
| SnapMesh (`mesh-net/compute/safety/app`) | Transport, sessions X25519+AES-GCM, sandbox worker, quorum 2/3, reçus Ed25519, START/STOP + budgets | Pont NeuroCore→M2 testé sur fil JSON en mémoire (`mesh.test.js`) | 2 appareils physiques, mTLS, exclusion auto : **[PRÉVU]**, LAN NON EXÉCUTÉ (M6) |
| NT-Flux (`mesh-flux/`) | Codecs zlib réels, politique au coût estimé, bénéfice mesuré (10240→7217 o) | — | Décision codec **non branchée** dans `flow.js` (`tCodec = octets/débit`, sans coût CPU) |
| Benchmarks | B0/B1/B2 fib : 100/100, écarts non significatifs (même hôte) ; NeuroCore A–E sub-ms | Workers = registres d'une machine | O5 (bénéfice Muse) non mesurable ici ; énergie jamais mesurée |

Preuves : `PROGRESS.md`, journaux `bench-logs/validation-*.log.txt`,
`bench-logs/neurocore-abcde-20261026.json`, `ntucp-poc-20261026.json`,
`m4-backends-20261026.json` (relus pour cet audit).

## 2. Travaux existants (comparaison, aucune nouveauté supposée)

- **EdgeShard** (Zhang et al., 2024, arXiv:2405.14371) : partition LLM par
  programmation dynamique + sélection d'appareils sur banc hétérogène réel ;
  jusqu'à −50 % de latence revendiqué **sur leur banc physique**. Notre
  graphe est un DAG générique petit (pas un LLM en pipeline) ; nous
  réutilisons l'idée « DP > glouton » sans reprendre leurs chiffres.
- **EdgeTP / EdgeATP** (ICDCS 2026 ; J. Syst. Archit. 2026, repérés par
  recherche bibliographique, textes non relus en intégralité — statut
  **[RECHERCHE]** pour le détail) : parallélisme tensoriel adaptatif sur
  grappes edge. Hors périmètre : Genesis ne découpe pas intra-opérateur.
- **HEFT et ordonnanceurs à coûts** (classiques) : rang + coût
  calcul/communication statique. `planGreedy`/NeuroCore en sont des
  variantes gloutonnes ; ONNX Runtime partitionne par Execution Provider
  avec repli CPU (intra-appareil, sans coût réseau ni mémoire cumulée
  inter-appareils).
- **Apprentissage en ligne des coûts** : EWMA/UCB connus ; le candidat
  bandit a déjà été écarté ici (`NEUROCORE_RESEARCH.md`) car il explorerait
  des workers incompatibles.

## 3. Conclusion d'audit

L'assemblage Genesis est réel et testé sur une machine. Trois trous précis,
vérifiables dans le code, sont détaillés en `02` : (P1) glouton séquentiel
sans mémoire cumulée ni optimisation globale des coupes ; (P2) modèle de
coût biaisé (int8 sans flops) et incertitude inutilisée ; (P3) vérification
binaire exacte incompatible avec l'hétérogénéité + capacités déclaratives
non éprouvées.

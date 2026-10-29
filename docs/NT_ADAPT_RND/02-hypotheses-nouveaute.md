# 02 — Trois problèmes, trois hypothèses, nouveauté

## Problèmes non suffisamment résolus par l'implémentation actuelle

- **P1 — Partitionnement glouton, mémoire par nœud seulement.**
  `planGreedy` et `NeuroCore.plan` fixent chaque nœud sans revoir les
  décisions précoces ; `validatePlan`/`checkAssignment` contrôlent chaque
  nœud isolément, jamais la somme par worker. `chooseCut/chooseSplit`
  existent mais ne sont appelés par aucun planificateur.
- **P2 — Coût biaisé, incertitude décorative.**
  Backend int8 sans `flops` mesuré → défaut 1 Mflops (biais ~×100 sur le
  modèle) ; `uncertainty` retournée par `evalPlacement` n'entre dans aucun
  choix ; débit réseau = défaut unique 25 Mio/s ; codec sans coût CPU.
- **P3 — Capacités déclarées, vérification binaire.**
  NT-NEGOTIATE accorde des *noms* (dtypes/backends) sans épreuve
  d'exécution ; la vérification NeuroCore exige l'égalité bit-à-bit, ce
  qui rejetterait des backends hétérogènes légitimes (fp32 JS vs ORT/DML)
  ou forcerait l'uniformité. Le pont M2 tolère déjà `rel < 1e-6` en test —
  sans contrat généralisé.

## Hypothèses (chacune réfutable, cf. 05)

- **H1 (retenue, primaire)** : une recherche globale bornée sur les
  affectations (chemin critique + transferts + mémoire cumulée) choisit
  des frontières strictement meilleures que le glouton dès qu'un cast ou
  une contrainte force un détour, et refuse des plans que le contrôle par
  nœud laisse passer. Différence vérifiable : affectations et octets,
  endpoints insensibles au bruit d'exécution.
- **H2 (secondaire, incluse en version prudente)** : un coût pessimiste
  `nominal × (1+risque) × (1+β·incertitude)` + amorçage par épreuves
  mesurées réduit les erreurs de modèle vs estimation ponctuelle.
  Réfutation : erreur de prédiction qui ne baisse pas sur signal stable.
- **H3 (secondaire, incluse en version minimale)** : une épreuve
  d'exécution réelle par (op, dtype) — temps médian + erreur max vs oracle
  fp64, reçue avec empreinte sha256 — calibre le coût mieux que les
  constantes, et une vérification `atol + rtol·|x|` accepte l'arrondi
  légitime tout en rejetant les fautes franches. Une signature/empreinte
  ne prouve **jamais** la bonne exécution distante (reçus + quorum §7).

## Nouveauté revendiquée (étroite, pas mondiale)

Aucune pièce n'est nouvelle (DP, EWMA, tolérances, épreuves sont connus).
La contribution testée est l'**assemblage réfutable** : recherche globale
× mémoire cumulée × pessimisme d'incertitude × épreuves mesurées × repli
local explicite, dans le moteur autonome existant, avec arbitre
déterministe (`validatePlan`) inchangé et journal des décisions.
Comparaison directe : mêmes graphes, mêmes workers, B0/B1/B2 vs B3 (06).

## Choix de l'expérience la plus prometteuse

H1 d'abord : (a) endpoints discrets (affectations, octets, faisabilité)
mesurables dès maintenant sur une machine, là où H2 exige des charges
≥ 10 ms et du matériel asymétrique réel pour dépasser le bruit sub-ms
déjà documenté (`NEUROCORE_LEARNING.md` §3) ; (b) échec possible et
observable (si le glouton égale le global partout, H1 tombe) ;
(c) H2/H3 entrent comme mécanismes auxiliaires mesurés séparément
(ablation : B3 avec/sans épreuves distingue calibration et recherche).

# 03 — Spécification du protocole et des contrats

## 1. Graphe intermédiaire (existant, inchangé)

DAG typé `nt-fusion/src/graph.js` v1 : nœuds `input|matmul|add|cast`,
dtypes `fp64|fp32|int8`, conversion implicite interdite (`cast` explicite),
shapes inférées, flops estimés. Limite assumée : tenseurs 2D, ≤ 64 nœuds.

Extension NT-ADAPT (sans changer le format) : tolérances de vérification
par défaut par dtype (`neurocore/src/adapt.js`, `TOLERANCES`) —
fp64 `1e-9/1e-12`, fp32 `1e-4/1e-6` (arrondi inter-backends mesuré
`< 1e-6` relatif sur le pont M2, marge ×100), chaîne int8 `rtol 0,03`
(erreur mesurée NT-UCP 1,40 %, marge ×2). Toute tolérance métier doit
être fournie explicitement ; elle borne l'acceptation, elle ne prouve pas
l'exécution.

## 2. Contrat de capacités vérifiées (NT-UCP + épreuve)

Chaîne existante conservée : NT-ID Ed25519 → NT-CERT signé → NT-NEGOTIATE
authentifiée (anti-rejeu, désaccord refusé) → `checkAssignment`
(backend×dtype×mémoire×threads, refus motivés). **La négociation prouve
l'accord sur des noms, pas la capacité réelle** (avertissement
`NT_UCP_SPEC.md` §4, toujours valable).

Ajout NT-ADAPT **[FONCTIONNEL, même processus]** : `probeWorker(worker)`
exécute réellement matmul fp32/int8, add, cast (nt-compat), mesure les
médianes (3 reps) et l'erreur max vs oracle fp64, et émet un reçu
`{v, workerId, n, ops, backends, hash: sha256(contenu)}`.
`seedLearnerFromProbe` injecte ces mesures dans NT-LEARN (EWMA bornée).
Portée honnête : l'épreuve prouve le registre **local** qui l'exécute ;
distribuée, elle devra voyager comme reçu signé NT-ID et rester
corroborée par quorum/re-calcul — jamais par la seule empreinte.
La cryptographie ne corrige aucune incompatibilité physique.

## 3. Négociation des backends

Détection réelle uniquement (`backends.js`) : présents = mesurés ou
résolus ; absents = motif. GPU/NPU absents restent absents. ORT :
`ortAvailable()/availableEps()` (cpu+dml mesurés, cuda absent sur ce
poste). Aucun plan ne peut exiger un backend absent (`checkAssignment`).

## 4. Contrat d'allocation NT-ADAPT

Entrées : graphe validé, workers `{id, registry}` (registre NT-COMPAT +
plafond `mem.capBytes`, `powerW` seulement si mesuré), apprenant optionnel,
liens `netBps` par paire (défaut documenté 25 Mio/s sinon), `beta`,
`localMargin`, `deadlineMs` optionnel.
Faisabilité : compatibilité par nœud **et** mémoire cumulée par worker
**et** deadline. Coût : chemin critique pessimiste (calcul mesuré/appris
+ conversions + transferts au débit du lien ; codec = raw sauf bénéfice
net mesuré par `measureLegWire` sur tampon réel). Énergie : `null` si
aucune puissance mesurée fournie — jamais estimée.
Sorties : plan v1 compatible `validatePlan` (arbitre déterministe),
`{evaluated, rejected{incompatible,memoire,deadline}, searchMode, reason,
bestSingleMs, bestDistributedMs}` journalisables. Repli : mono-worker si
le distribué ne gagne pas ≥ `localMargin` (défaut 5 %).
Sécurité : identités NT signées et anti-rejeu hérités (M1/NT-UCP/NT-PQ) ;
aucune exécution de code réseau (kinds fermés) ; STOP/budgets via le
frein `brake` consulté avant placement et exécution (inchangé).

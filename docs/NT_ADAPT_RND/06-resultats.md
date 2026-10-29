# 06 — Résultats reproductibles

> Commande : `node scripts/bench-ntadapt.js --reps 7`
> Journal brut : `bench-logs/ntadapt-2026-10-29.json` (en-tête machine,
> Node v24.14.0, même hôte, processus locaux, fil COMPTÉ).
> Chiffres ci-dessous = run du 2026-10-29 ; les temps sub-ms varient d'un
> run à l'autre et ne fondent aucune allégation réseau.

## S1 — chaîne mixte n=32, asymétrie ÉMULÉE (wB fp32×8 sans int8, lien 256 Kio/s)

| Bras | Faisable | Transferts | Makespan modèle | Plan méd. | Exec locale méd. |
|---|---|---|---|---|---|
| B0 local | oui | 0 o | — | ~0,003 ms | ~0,55 ms |
| B1 round-robin | **non** (int8 sur wB) | — | — | ~0,06 ms | n/a |
| B2 NeuroCore actuel | oui | 4096 o | 83,5 ms* | ~0,46 ms | ~0,31 ms |
| B2g greedy (lien connu) | oui | 4096 o | 82,3 ms* | ~0,07 ms | ~0,21 ms |
| B3 NT-ADAPT | oui | **0 o** | 0,69 ms | ~0,41 ms | ~0,21 ms |

Exactitude vs B0 : tous les bras exécutés à `maxAbs = 0` (même moteur,
tolérance fp32 vérifiée, pas seulement supposée).

*Décomposition obligatoire* : l'écart de makespan modèle (83 → 0,69 ms)
vient surtout de la **calibration** (le défaut int8 à 1 Mflops gonfle B2),
pas de la recherche. La contribution de la recherche se lit sur les
**affectations** : B2/B2g placent `mm` sur wB rapide puis paient la coupe
de 4096 o vers la chaîne int8 ; B3 coloque toute la chaîne sur wA
(0 transfert). Sans épreuves, B3 prend la même décision (test unitaire,
lien lent) avec un makespan modèle pessimiste surévalué — l'ablation
distingue bien les deux mécanismes.

## S2 — symétrique n=16 : NT-ADAPT perd (et le dit)

B3 choisit le repli local (`nt-adapt-local`, 0 transfert) : distribuer ne
paie pas. Sa surcharge de planification (~0,8 ms méd.) dépasse le temps
d'exécution locale (~0,06 ms) : sur petits graphes symétriques, B0 reste
le bon choix et NT-ADAPT n'apporte que le coût de sa recherche.

## S3 — mémoire cumulée ÉMULÉE (plafond 6000 o, mono = 7168 o)

B2 produit un plan que `validatePlan` accepte nœud-par-nœud mais
cumulativement infaisable (rapporté `faisable=false` par re-calcul du
bench) ; B3 sépare les deux branches (1024 o transférés) et passe les
deux contrôles. C'est le cas où NT-ADAPT gagne sans aucun transfert évité.

## Micro-mesures réelles (même processus)

Épreuves : matmul fp32 32×32 ≈ 0,05 ms, erreur max vs oracle fp64 = 0
(valeurs exactement représentables dans ce banc ; ne généralise pas).
Compression 64 Kio sur lien 1 Mio/s : répétitif → gzip 97 o, bénéfice
net +62 ms (coût CPU mesuré 0 ms à la résolution `process.cpuUsage`) ;
aléatoire → raw (aucun bénéfice). La décision suit la mesure, pas une
règle fixe.

## Non-régression (séquentiel, 2026-10-29)

`neurocore` unit+adapt **15/15**, `nt-fusion` **7/7**, `nt-compat`
**5/5**, `mesh-flux` **7/7**. Tests NT-ADAPT seuls : 8/8 (coupe au cast,
mémoire cumulée, repli local, arbitre, tolérances, épreuve, compression,
autonomie fetch-espion).

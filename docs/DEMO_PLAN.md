# Neuroterra SnapMesh Genesis — Plan de démo (3 minutes)

> Objectif : prouver en 180 secondes qu'un maillage hétérogène exécute un
> calcul IA fiable, vérifiable, et survivant à une panne. Zéro mesure
> inventée à l'écran.

## Matériel requis (réel ou émulé local, étiqueté honnêtement)

3 nœuds : ex. portable (coordinateur), portable secondaire ou VM (GPU/CPU),
Raspberry Pi ou conteneur contraint (nœud faible). Un écran projette le
tableau de bord : topologie, file de tâches, décisions Muse, quorum.

## Script minute par minute

| Temps | Action | Preuve visible |
|---|---|---|
| 0:00–0:30 | Contexte + topologie : les 3 nœuds se découvrent en direct | pairs listés, latences |
| 0:30–1:30 | Tâche IA (ex. embeddings + inférence légère) répartie par Muse | affectation expliquée affichée |
| 1:30–2:15 | **Panne injectée** : kill d'un nœud ; ré-affectation automatique | complétion malgré la panne |
| 2:15–2:50 | Vérification : signatures + vote du quorum affichés | résultat marqué « vérifié » |
| 2:50–3:00 | Chiffres du jour (issus des journaux) + clôture | makespan, surcoût quorum |

## Plan B (si panne réelle pendant la démo)

Mode dégradé préparé : repli déterministe sans Muse, puis rejouage local
enregistré étiqueté « rejouage ». On ne bluffe jamais : ce qui est rejoué
est annoncé comme rejoué.

## Checklist pré-démo

Réjoui 3 fois sans échec (gate M5), batteries/secteur vérifiés, hotspot de
secours, journaux du jour exportés, checklist imprimée, minuteur visible.

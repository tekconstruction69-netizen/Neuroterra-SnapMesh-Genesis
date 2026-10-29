# NeuroCore — Recherche : hypothèse et candidats

## 1. Hypothèse réfutable

« Un placement au coût total appris (EWMA par op×worker×dtype, avec
hystérésis) rejoint le meilleur placement statique en ≤ N exécutions
et le dépasse quand un worker dérive ou tombe, sans jamais exécuter
un plan invalide. » Réfutation : erreur de prédiction qui ne décroît
pas sur signal stable, oscillations, ou plan invalide exécuté.

## 2. Trois candidats comparés

| Candidat | Principe | Verdict |
|---|---|---|
| A. Bandit contextuel (UCB/softmax) | exploration aléatoire bornée | ÉCARTÉ : explorerait des workers incompatibles/lents au hasard ; incompatible avec la règle « jamais d'invalide » sans garde coûteux |
| B. EWMA + hystérésis + reset dérive | statistique légère O(1), déterministe, préférence stabilisée | RETENU : testé (convergence exacte sur signal stable, anti-oscillation prouvée, dérive réinitialisée) |
| C. Modèle local entraîné (régression) | prédit ms depuis (flops, octets, charge) | ÉCARTÉ : surcoût d'entraînement injustifié à cette échelle ; rejoindrait B en précision pour 100× le coût |

Approche sélectionnée : B, meilleur compromis intelligence/précision/
coût, sans grand modèle (exigé §4).

## 3. Mécanisme original assemblé

La contribution n'est pas un algorithme isolé mais la combinaison
mesurable : compatibilité refusante (NT-COMPAT) × coupe au point de
conversion (NT-RECOMPOSE) × coût appris stabilisé (NT-LEARN) ×
arbitre systématique × frein safety — avec journal d'explicabilité.
Chaque pièce est testée ; l'assemblage est benché (A–E).

## 4. État de l'art visé (honnête)

Ordonnancement hétérogène : HEFT (coût computation/communication
statique), Ray/K8s (placement générique), ONNX EP (partition par
backend, pas de coût appris). Différence : coûts APPRIS en ligne +
refus de l'invalide + replan sans coordinateur fixe. Aucune
revendication d'invention mondiale : comparaison scientifique =
bench A–E ci-joint, reproductible.

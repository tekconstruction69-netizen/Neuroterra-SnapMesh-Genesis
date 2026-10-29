# M4 — Plan démo 3 minutes (problème réel → solution mesurée)

> Support : `scripts/demo-bout-en-bout.ps1` (hors sandbox) + app locale.
> Durées indicatives, minuteur visible. Aucune promesse de revenu.

## 0:00–0:30 — Le problème (réel, vérifiable)

« Coordonner des appareils hétérogènes pour un calcul vérifié, sans
cloud, sans compte, avec un bouton STOP qui marche. » Montrer l'app :
état STOPPED, pairs 0, note « pas des plafonds matériels ».

## 0:30–1:30 — La solution en direct

1. Lancer l'exécutant + START (consentement). Pair maillé, session
   vérifiée (afficher `/status`).
2. Soumettre `batch-fib [20,25,30]` → verdict `done`,
   `6765,75025,832040` (valeurs connues, vérifiables de tête) +
   empreinte finale affichée.
3. Montrer le faisceau : fragments exécutés PAR l'exécutant (pas en
   local), graphe des nœuds.

## 1:30–2:15 — La panne (différenciant)

Killer l'exécutant en direct → relance → 2e job `done` : reprise
prouvée, pas de tâche perdue. Citer le chiffre : STOP annule en
< 2 s (mesuré), replan automatique.

## 2:15–3:00 — L'IA réelle et les limites (honnêteté)

Inférence ONNX exécutée (Gemm exact, erreur 0 ; ORT-cpu ×5 à 64²,
DML plus lent — chiffres affichés). Clore sur les limites : 2-PC et
LAN en procédure, pas de cloud, pas de revenu, code et mesures
publics (dépôt nettoyé, `check-export-public.js` vert).

## Matériel requis

2 PowerShell (app + exécutant) sur le même PC, ou 2e PC pour le LAN
(procédure `TEST-LAN-DEUX-PC.md`, consentement + sans pare-feu modifié).

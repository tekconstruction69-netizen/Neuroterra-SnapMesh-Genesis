# Application utilisateur — contribuer en sécurité (M2-SAFETY)

> Interface simple : un bouton START/STOP, trois modes, l'état réel.
> Français uniquement. **Aucun revenu promis, aucun calcul sans preuve.**

## 1. Démarrage (boucle locale uniquement)

```powershell
cd <repo-root>\mesh-app
node server.js --port 48700
```

Ouvrez ensuite dans un navigateur : **http://127.0.0.1:48700/**
(servi en boucle locale ; Chrome/Edge sur `localhost` acceptent
l'installation PWA via l'icône de la barre d'adresse).
Le serveur ne survit pas à la fin de session : relancez la commande.

## 2. Utilisation

1. Lisez l'état (arrêté au démarrage) et cochez le **consentement**.
2. Choisissez Éco (1 %), Équilibré (5 %) ou Performance (10 %).
3. Appuyez **DÉMARRER** : préconditions vérifiées (batterie, mémoire,
   thermique), sinon refus expliqué.
4. Suivez CPU mesuré, mémoire, nœuds, tâches et résultats vérifiés.
5. **ARRÊTER** à tout moment : prioritaire, annule et confirme.

États affichés : arrêté, démarrage, actif, limitation thermique,
suspendu, erreur (+ motif en clair). En urgence thermique, la reprise
exige des conditions sûres et un nouveau START.

## 3. Limites annoncées dans l'app

Objectifs % coopératifs (pas de plafonnement matériel) ; thermique sans
sonde fiable = politique conservatrice ; pas de calcul en arrière-plan
fiable en PWA ; Android/iOS natifs non implémentés.

## 4. Calcul vérifié depuis l'app (§9)

Nouveaux panneaux : **profil NT-ID** (id cryptographique, nom, placement
autorisé oui/non), **capacités NT-CAP** (soi + pairs, sessions vérifiées),
**graphe temps réel** (liens = sockets rattachés observés), **soumission**
(preset + JSON → `POST /api/job`).

`POST /api/job {"preset": "batch-fib"|"split-wordcount"|"chain-matmul",
"params": {...}}` → exécute le DAG (fragments → placement → exécution →
vérification) et rend `{outcome, value, fragments, verification}` avec
`finalHash`. Refusé **409** sans contribution (STOPPED/SUSPENDED/ERROR) :
le frein prime aussi sur les jobs, et STOP annule les exécutions locales
en vol (sandbox). `GET /api/state` expose `profile`, `caps`, `graph`,
`jobs` (10 derniers, faisceaux inclus, signatures tronquées nulle part :
entières).

Les capacités publiées aux pairs (`NT-CAP`) incluent désormais les limites
du contrôleur et la batterie/thermique telles que mesurées (indisponibles
ici, jamais inventées).

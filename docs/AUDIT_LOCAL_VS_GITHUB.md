# AUDIT — Local contre GitHub (commit `dfe9724`)

> Comparaison en lecture seule, sans réseau. `dfe9724` = contenu déployé
> sur Netlify et publié sur GitHub (voir `docs/DEPLOYMENT_REPORT_20261029.md`).

## Ce qui est déjà public (`dfe9724`, déployé)

Site `https://neuroterra-snapmesh-genesis.netlify.app`, dépôt public,
fonctions `gateway`/`join` informatives, frontend avec démonstration
explicite, 8 fichiers servis vérifiés, TLS valide.

## Différences locales NON publiées (risque de publication si push sans revue)

| Fichier | Nature | Risque |
|---|---|---|
| `mesh-app/public/*` (744 lignes ±) | Refonte visuelle : 3 onglets, Vision, Mon appareil, connexions, protection, adaptateurs | Moyen : nouveau JS à revue (injection HTML pairs échappée, vérifiée) |
| `mesh-app/server.js` (+25) | `hadPeers`, `workerState` dérivé, `hardware` dans `/api/state` | Faible : logique lue, pas de secret |
| `mesh-safety/src/controller.js` (+20) | `deriveWorkerState` 9 états | Faible |
| `mesh-safety/src/sysinfo.js` + `test/states.test.js` (non suivis) | Sonde système lecture seule + tests 21/21 | Faible |
| `docs/JOURNAL.md` (+9 lignes) | Traçabilité sessions | Nul |
| Image PNG maquette + `MISSION_AUDIT…md` (non suivis) | Référence visuelle + mission | À décider (poids, pertinence publique) |
| `bench-logs/deploy-*`, `docs/DEPLOYMENT_REPORT_20261029.md` (non suivis) | Preuves de déploiement | Faible : URLs publiques déjà connues, pas de secret |

## Règle de publication recommandée

Ne pousser qu'après revue des 6 fichiers modifiés + décision explicite
sur l'image et le rapport de déploiement. Ne jamais commiter de `.key`
(rappel : régénérés par les tests, couverts par `.gitignore`).

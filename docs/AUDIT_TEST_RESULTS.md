# AUDIT — Résultats de tests (2026-10-29)

> Exécuté : suites unitaires locales séquentielles + contrôles statiques.
> NON EXÉCUTÉ : navigateur réel, sockets/2 PC, matériel Bluetooth/Wi-Fi
> Direct, installation Windows/iPhone, Supabase, ORT-GPU distribué.
> Node v24.14.0, Windows, même hôte.

| Suite | Commande | Résultat |
|---|---|---|
| mesh-safety (unit + hardware + states) | `node --test test/states.test.js test/unit.test.js test/hardware.test.js` (séquentiel, ce jour) | **21/21 PASS** |
| mesh-app gardes | `node --test mesh-app/test/guards.test.js` | **PASS** |
| neurocore (unit + adapt) | `node --test test/unit.test.js test/adapt.test.js` | **16/16 PASS** (session précédente, code inchangé depuis) |
| nt-compat / nt-fusion / mesh-flux | suites unitaires | **5/5, 7/7, 7/7** (session précédente) |
| Syntaxe frontend | `node --check mesh-app/public/app.js`, 65 ids vs HTML | OK, aucun manquant |
| Secrets | `node scripts/check-export-public.js` + index Git | Propre, 284 fichiers sains |

Références historiques (même hôte, non rejouées ce jour) : M1 37/37,
M2 63/63, benches NT-ADAPT/NT-UCP/NT-FUSION avec journaux `bench-logs/`,
déploiement HTTPS vérifié (`docs/DEPLOYMENT_REPORT_20261029.md`,
41/41 le 29/10 par l'équipe). Tests 2 PC / 2 réseaux : NON EXÉCUTÉS
(aucun journal des deux côtés).

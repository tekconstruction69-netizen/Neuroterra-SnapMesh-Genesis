# GENESIS — Contrôle de sortie avant publication (2026-10-29)

> Rien n'a été publié. Toute ligne ci-dessous repose sur une exécution
> réelle de ce jour, sauf mention NON TESTÉ. Node v24.14.0, Windows,
> même hôte, suites séquentielles.

## Tests réussis (89/89, 0 échec)

| Suite | Résultat |
|---|---|
| mesh-safety (états, unit, matériel, dont P0 setTargets + sonde Wi-Fi) | 22/22 |
| mesh-compute (sandbox, unit, P0 shutdown sous charge) | 27/27 |
| neurocore (unit + NT-ADAPT) | 16/16 |
| nt-compat | 5/5 |
| nt-fusion | 7/7 |
| mesh-flux | 7/7 |
| nt-registry | 3/3 |
| mesh-app gardes d'API | 2/2 |
| Syntaxe JS publics + 65 identifiants d'interface présents | OK |
| Contrôle de secrets + index Git | Propre |

## Problèmes bloquants : AUCUN

Les deux P0 sont corrigés et prouvés : arrêt réel des threads avec
refus post-arrêt, réglages strictement validés. Dernier ajustement : un
test existant fragilisé par l'arrêt réel (gestionnaire de rejet) —
intention inchangée.

## Fonctionnalités non terminées (connues, affichées honnêtement)

Bluetooth et Wi-Fi Direct comme transports, thermique mesurée, NAT et
relais chiffré, Supabase, GPU/NPU distribués, Wallet/Invest/Récompenses,
installation Windows et PWA constatées, tout essai multi-appareils.

## Fichiers modifiés depuis le commit public `dfe9724`

Suivis : `mesh-app/public/*` (refonte validée), `mesh-app/server.js`
(états dérivés, analyse système), `mesh-safety/src/controller.js`
(états + P0-2), `mesh-compute/src/sandbox.js` (P0-1),
`mesh-compute/test/sandbox.test.js` (ajustement), `docs/JOURNAL.md`.
Non suivis en attente de décision : `mesh-safety/src/sysinfo.js`,
`mesh-safety/test/states.test.js`, rapports d'audit, image de référence
PNG, journaux de déploiement locaux.

## Affichage PC / iPhone / Android : NON TESTÉ

Aucun de ces environnements n'est disponible dans cet environnement
d'exécution (pas de navigateur automatisé, pas de sockets, pas de
second appareil). À valider par le propriétaire avant publication.

## État de préparation au déploiement

Code prêt, preuves locales complètes, documentation à jour. Prérequis
restants : validation visuelle et fonctionnelle réelle (PC + iPhone),
test sur 2 PC, revue pré-push des différences ci-dessus, autorisation
explicite de publication.

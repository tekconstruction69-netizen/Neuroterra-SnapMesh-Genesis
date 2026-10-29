# M6 — Résultats

> Run du 2026-10-29, poste `neuro` (192.168.1.66, Node v24.14.0).
> PHYSIQUE multi-machines : **NON EXÉCUTÉ** (aucun second PC accessible
> ou configuré ; sockets `listen` interdits dans le sandbox : EACCES).

## Réussi [LOCAL, mesuré]

- Routage NT-ADAPT 2 : 9/9 tests adapt (cache avantagé, confidentialité
  refusant le distribué avec motif, worker nié jamais choisi, cloud
  jamais appelé — présence de clé seulement). Journal : suite neurocore.
- Bout-en-bout `scripts/m6-e2e-local.js` (exit 0) : route choisie =
  repli local motivé (distribué 0,200 ms ≱ mono 0,210 ms à 5 %) ;
  nominal `done`, panne injectée + replan `done`, doublon déterministe
  (empreinte `d1ab1c5d37c3ec5d` identique), inférence ONNX Runtime CPU
  réelle n=64 en ~0,8–1,3 ms (varie par run) avec accord JS `maxRel = 0`
  sur ce banc. Brut : `bench-logs/m6-e2e-2026-10-29.json`.
- Comparaison B0/B1/B2/B3 (décision ÉMULÉE) : cf.
  `docs/NT_ADAPT_RND/06-resultats.md` et `bench-logs/ntadapt-2026-10-29.json`
  (B3 : 0 o contre 4096 o en S1 ; S3 faisable contre B2 infaisable).
- Worker PC-B : `scripts/M6-WORKER.ps1` syntaxe PSParser 0 erreur,
  ASCII strict, codes de sortie documentés ; `check-export-public`
  et suites séquentielles relancés (voir JOURNAL 2026-10-29).

## Échecs et blocages (consignés, pas masqués)

- Panne sur nœud d'entrée : l'attribution du worker fautif par
  `flow.js` (worker du nœud en échec, y compris `input`) peut rendre la
  reprise impossible quand le survivant est incompatible — refus propre
  et motivé observé, reprise démontrée sur nœud de calcul. Correction
  d'attribution : **[PRÉVU]**.
- Sockets : `listen EACCES` en sandbox (exit 2 = environnement bloqué,
  jamais déguisé en échec fonctionnel) ; harnais 2 PC prêt hors sandbox.
- VRAM, énergie, thermique : non mesurées sur ce poste (sondes absentes).

## Revérification finale (2026-10-29)

Relance du point « run physique » : aucun pair configuré
(`SNAPMESH_PEER`/`M6_PC2_HOST` absents), aucun journal `m5-lan-*`
archivé, ce poste seul visible (192.168.1.66) et `listen` toujours
interdit dans le sandbox (EACCES). Le run à deux PC exige deux
opérateurs, un lancement hors sandbox et le consentement `OUI` sur
chaque machine : il reste donc **NON EXÉCUTÉ**, sans latence, débit ni
reconnexion inter-machines à rapporter. Toute valeur de ce type serait
inventée ; les seules mesures réseau-adjacent valides sont les octets
comptés et les temps locaux des journaux ci-dessus. Procédure et
critères d'acceptation : `M6_TEST_PLAN.md` et `M6_LAN_REPORT.md`.

## Restant à démontrer [PRÉVU]

Run physique 2 PC complet (maillage, job chiffré, kill/reconnexion),
latences et débits réseau réels, bénéfice éventuel du partitionnement
sur matériel asymétrique, NAT/relais chiffré, moteurs GPU/NPU réels.

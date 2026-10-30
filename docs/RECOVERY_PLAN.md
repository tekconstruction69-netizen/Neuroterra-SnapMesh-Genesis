# Plan de reprise P0 / P1 / P2 — AUCUNE CORRECTION APPLIQUÉE

> Chaque étape = un petit changement testé, à valider par le propriétaire
> avant exécution. Dépendances et critères d'acceptation inclus.

## P0 — Sécurité d'arrêt et d'admission : EXÉCUTÉ le 2026-10-29

P0-1 et P0-2 appliqués et prouvés (voir `docs/AUDIT_SECURITY_20261029.md`,
section Corrections). Reste P0-3 (revue pré-push) avant toute publication.

## Ancien plan (conservé pour traçabilité)

- **P0-1 `Sandbox.shutdown()`** : terminer chaque worker actif
  (`worker.terminate()`) avant `clear()`, attendre avec borne.
  Dépendance : aucune. Acceptation : test STOP pendant charge CPU —
  threads à 0 et charge retombée après arrêt. Risque : faible.
- **P0-2 `setTargets()`** : valider `workers`/`concurrent` (entiers ≥ 1,
  finis), refuser `NaN`/`Infinity`/chaînes/null, ne jamais écraser par
  `undefined`. Acceptation : cas limites en unitaire + `POST /api/targets`
  invalide → 400 sans mutation. Risque : faible.
- **P0-3 Revue pré-push** : relire les 6 fichiers modifiés, décider du
  sort de l'image PNG et du rapport de déploiement, rejouer gardes +
  safety. Acceptation : index sans suspect, export propre.

## P1 — Robustesse fonctionnelle

- P1-1 Verrouiller `estMemBytes` (documenter ou brancher la borne).
- P1-2 Journaliser `hadPeers`/transitions d'état côté serveur pour
  diagnostic (déjà exposé dans `/api/state`).
- P1-3 Durcir `join` (déjà 403/501) : rate-limit si exposition élargie.

## P2 — Preuves physiques

- P2-1 Run 2 PC LAN avec les deux journaux (`M6_LAN_REPORT.md`).
- P2-2 Installation Windows + PWA iPhone constatées, pas affirmées.
- P2-3 Benchmarks LAN réels avant tout discours de bénéfice distribué.

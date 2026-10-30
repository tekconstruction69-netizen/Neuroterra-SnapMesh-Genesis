# Étude — Noyau Rust partagé pour SnapMesh (2026-10-29)

> Aucune chaîne Rust sur ce poste (`rustc`/`cargo` absents) : étude
> documentaire et critères de décision, aucun code écrit, rien à tester.

## Périmètre candidat (protocole uniquement, jamais l'ordonnancement)

Réimplémenter en Rust : cadrage des trames DIRECT v1, vérification
d'enveloppes (Ed25519 via crate `ed25519-dalek`, jamais de crypto
maison), chiffrement X25519+AES-GCM (crates éprouvées), TTL et
anti-boucle, file bornée. Exclus : NeuroCore, NT-ADAPT, négociation
NT-UCP, quorum, interface — conservés en Node.js.

## Intégrations comparées

- **Processus autonome + messages versionnés** : isolation maximale,
  STOP par signal, aucun ABI natif, surcoût de sérialisation mesurable.
  Recommandé en premier si le Rust se justifie.
- **Module napi-rs** : appels directs, mais chargement natif par
  plateforme, repli Node obligatoire si binaire absent, surface de
  sécurité élargie (mémoire native). Second seulement, avec preuves.

## Critères de décision (seuils avant toute migration)

1. Gain mesuré ≥ 30 % sur latence de traitement de trames ou débit,
   mêmes tâches, ≥ 5 répétitions, journal brut — sinon conserver Node.
2. Aucune régression des suites existantes (toutes vertes avant/après).
3. Binaires reproductibles Windows/Linux/macOS ; Android (NDK) et iOS
   évalués séparément, jamais supposés.
4. Audit des crates (versions épinglées, `cargo audit` propre).

## Limites inchangées par Rust

GPU/NPU/VRAM (API constructeurs), thermique (capteurs OS), sandbox OS
(Rust seul n'isole pas les processus), permissions radio (OS).

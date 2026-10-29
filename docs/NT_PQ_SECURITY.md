# NT-PQ — Sécurité post-quantique

> Extension hybride PRUDENTE : on n'abandonne rien d'éprouvé, on ajoute
> du PQ standardisé à côté. Mesures réelles du 2026-10-26 (node:crypto
> de Node v24.14.0, médianes /20) — pas de crypto maison, jamais.

## 1. Standards (vérifiés)

- FIPS 203 (ML-KEM, ex-Kyber) : encapsulation de clés, finalisé 08/2024.
- FIPS 204 (ML-DSA, ex-Dilithium) : signatures, finalisé 08/2024.
- FIPS 205 (SLH-DSA) : signatures hash-based, finalisé 08/2024 (non
  utilisé ici : signatures géantes, besoin non démontré).
- node:crypto expose `ml-kem-{512,768,1024}` et `ml-dsa-{44,65,87}`
  (prouvé par sonde : tous `OK`).

## 2. Construction [FONCTIONNEL, testé 6/6]

- Session hybride (`nt-pq/src/hybrid.js`) : ECDH X25519 mutuel + UNE
  encapsulation ML-KEM-768 (initiateur→répondeur) ;
  secret = HKDF-SHA256(ecdh || kem) (même primitive que §3).
  Sûr si l'une des deux moitiés tient (classique ET post-quantique).
- Signatures (`sigs.js`) : ML-DSA-65 sur reçus compatibles §7
  (octets canoniques + `nonce` 16 o) ; `NonceCache` anti-rejeu
  (capacité + TTL + purge) ; `KeyRegistry` (rotation avec filiation,
  révocation immédiate, rotation sur révoquée interdite).
- Tests : concordance A/B, attaquant exclu, ct altéré détecté,
  falsifié/mauvaise-clé rejetés, rejeu rejeté puis réadmis après TTL.

## 3. Surcoût mesuré (médianes /20, ce poste)

| Primitive | Classique | PQ | Facteur |
|---|---|---|---|
| Clé publique | X25519 44 o | ML-KEM-768 1206 o | ×27 |
| Handshake | ECDH 0,036 ms | encaps 0,037 ms | ≈1 (temps) |
| Signature | Ed25519 0,042 ms / 64 o | ML-DSA-65 0,825 ms / 3309 o | ×20 temps, ×52 taille |

Conséquence : le PQ coûte des OCTETS (HELLO/SESSION-KEY ×27,
RESULT ×52), pas du temps CPU. Prévoir fragmentation/quotas avant
tout déploiement réseau ([PRÉVU] : intégration au protocole §3).

## 4. Interdit de revendiquer

- « Quantum-safe » / « quantum-proof » : NON revendiqué — pas d'audit
  indépendant, hybride non intégré au transport, menaces
  (récolte-actuelle/déchiffrement-futur, downgrade) non traitées.
- Compatibilité : Ed25519 reste le défaut ; ML-DSA coexiste par `kind`
  (interop d'arbitre, jamais de bascule silencieuse).
- Rotation : l'ancienne clé est révoquée, pas effacée (traçabilité) ;
  la filiation est déclarative, pas une preuve de continuité.

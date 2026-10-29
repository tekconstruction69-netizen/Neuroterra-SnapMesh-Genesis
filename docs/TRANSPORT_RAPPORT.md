# Rapport §3 — Transport chiffré + relais minimal [FONCTIONNEL, même hôte]

> Mission CORE ARCHITECTURE EVOLUTION §3. Tout résultat ci-dessous est mesuré
> sur le même ordinateur (loopback 127.0.0.1), jamais multi-appareils.
> Inter-machines : `scripts/TEST-LAN-DEUX-PC.md`, NON EXÉCUTÉ.

## 1. Ce qui a été construit

| Élément | Fichier | État |
|---|---|---|
| Dérivation X25519 éphémère + HKDF-SHA256 + AES-256-GCM | `mesh-net/src/session.js` (nouveau) | [FONCTIONNEL] |
| Types SESSION-KEY / ENCRYPTED / RELAY, renégociation, révocation des clés avec l'identité | `mesh-net/src/node.js` | [FONCTIONNEL] |
| `sendEncrypted()` : chiffré si canal prêt, sinon clair **signalé** (`plain`) | `mesh-net/src/node.js` | [FONCTIONNEL] |
| Relais minimal : forward 1-saut d'enveloppe scellée (TASK/RESULT), TTL, apprentissage clé origine vérifiée | `mesh-net/src/node.js` (`sendRelayVia`, `sealFor`, `pubB64`) | [FONCTIONNEL] |
| TASK/RESULT via canal chiffré + observabilité (`[canal]`, `[exec] chiffré=`, `resultatsChiffres`) | `mesh-compute/src/compute.js`, `bin/compute-node.js`, `mesh-net/bin/snapmesh-node.js` | [FONCTIONNEL] |

Zéro dépendance externe (Node.js 24 natif : `node:crypto`).

## 2. Preuves (tests réels, suites séquentielles, ports isolés)

| Suite | Résultat | Journal brut |
|---|---|---|
| `mesh-net/test/session.test.js` (crypto pur : DH croisé, altération données/tag, mauvaise clé, aléa éphémère) | **6/6** | `bench-logs/core-20261026-m1b.log` |
| `mesh-net/test/transport.test.js` (vrais sockets : canal bilatéral, repli `plain` signalé, `no-session-key`, relais A→B→C sans lien direct, TTL/type rejetés) | **5/5** | `bench-logs/transport-20261026.log` |
| `mesh-compute/test/encrypted.test.js` (vrais processus + proxy TCP : tâche `sha256-hex` réussie, `[exec] chiffré=1`, `resultatsChiffres≥1`, fil sans secret ni empreinte) | **1/1** | `bench-logs/transport-enc-e2e-20261026.log` |
| Fail-first : même test avec envoi clair restauré temporairement | **ÉCHEC prouvé** (✖ à 9,3 s, cohérent avec l'assertion `chiffré=1`) | `bench-logs/transport-failfirst-20261026.log` |
| Non-régressions : M1 **37/37**, M2 **24/24**, safety **15/15**, app **4/4** | verts | `bench-logs/core-20261026-m1b.log`, `core-20261026-m2b.log`, `safety-20261026b.log`, `safety-app-20261026b.log` |

Copies versionnables (sans secret, vérifié par recherche) : `bench-logs/validation-transport-20261026.log.txt`,
`validation-m1-20261026b.log.txt`, `validation-m2-20261026b.log.txt`, `validation-safety-20261026b.log.txt`.

## 3. Limites honnêtes

- **Relais en clair signé** : le relais transporte des enveloppes signées lisibles
  par le relayeur ; le chiffrement bout-en-bout via relais [PRÉVU]
  (nécessite échange de clés via relais).
- **Pas de routage multi-sauts** : un seul saut logique par RELAY (imbrication
  refusée `relay-nested`) ; choix du relayeur par l'appelant, politique de
  routage [PRÉVU].
- **Repli clair** : sans canal prêt, TASK/RESULT partent en clair signé avec
  `enc:false` / retour `plain` — jamais silencieux, mais à surveiller
  (`resultatsChiffres`, `[rejeté]`) ; durcissement « exiger le chiffrement »
  [PRÉVU] M4.
- **TOFU inchangé**, clés `0o600` inopérantes sur Windows, mTLS [PRÉVU] M4.
- Le détail d'assertion du run fail-first n'a pas été capturé (runner resté
  pendu : proxy non fermé sur échec — corrigé depuis par fermeture en
  `after()`, vérifiée : le run SUCCÈS s'est terminé proprement) ; la
  sensibilité est établie par l'ÉCHEC en clair + le SUCCÈS chiffré du même test.

## 4. Bogues rencontrés et corrigés

1. `hkdfSync` Node 24 renvoie `ArrayBuffer`, pas `Buffer` → normalisation
   (`session.js`).
2. Rentrée relais détruisait le lien du relayeur → chemin `direction === 'relay'`
   dédié (vérification + remise, sans rattachement ni destruction).
3. Renégociation de test unilatérale insuffisante → échange bilatéral explicite.
4. Proxy de test non fermé sur échec → `after()` global + orphelin tué sur
   ligne de commande exacte (aucun autre processus touché).

## 5. Prochaine étape

§4 Secure sandbox (worker borné + doc d'isolation réelle), sans réécrire les
modules §1-3 qui restent verts.

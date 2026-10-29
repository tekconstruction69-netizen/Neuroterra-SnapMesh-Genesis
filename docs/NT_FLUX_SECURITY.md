# NT-Flux — Sécurité

> Menaces, gardes et limites prouvées. Toute affirmation renvoie à un
> test ou est marquée [PRÉVU]/[RECHERCHE].

## 1. Principes

- Authentification M1 conservée : TASK/RESULT exigent une session
  vérifiée ; la ref ne crée aucun canal de confiance nouveau.
- **La compression n'est pas du chiffrement.** Les enveloppes `flux`
  transitent par le canal existant (chiffré si session X25519 prête,
  sinon clair signalé — même discipline que M2, §3).
- Codecs sans état, pas de dictionnaire partagé : aucun mélange
  inter-tâches par le contexte de compression.
- Stores dedup **partitionnés par expéditeur** : un pair ne résout
  que les fragments reçus DE ce coordinateur. Aucune donnée
  confidentielle multi-utilisateurs dans un même contexte.

## 2. Bombes de décompression [FONCTIONNEL]

| Garde | Où | Preuve |
|---|---|---|
| Borne absolue sortie `maxDecompressedBytes` (4 Mio) | `unpack` | unit bombe 7/7 |
| Borne absolue entrée `maxCompressedBytes` (2 Mio) | `unpack` | unit bombe 7/7 |
| Pré-refus gzip via ISIZE **sans gonfler** | `announcedSize` | unit bombe 7/7 |
| Codec inconnu / enveloppe invalide → refus | `unpack` | unit + wire ref-inconnue |
| Ratio > 1000× = `suspicious` SIGNALÉ, non bloquant | `unpack` | unit (brotli légitime 270×+ accepté) |

Le ratio seul ne bloque jamais : un texte légitime très redondant
dépasse 1000× (brotli). La borne absolue est la vraie protection.

## 3. Références et intégrité [FONCTIONNEL]

- Ref = sha256 hex des BYTES JSON (ordre préservé), 64 o.
- `ref` acceptée seulement si le store du bon expéditeur la résout
  **et** l'empreinte est re-vérifiée au `get` (`DedupStore`).
- Quotas : `maxEntries`, `maxBytes` (éviction LRU), TTL
  (`ttlMs`) — prouvés en unit (quotas, expiration, intégrité).
- `dedupAck` : le destinataire confirme détenir le fragment ; le
  coordinateur n'envoie `ref` qu'après ack. Ack forgé sans détention
  → `flux-unknown-ref` côté exécutant, refus silencieux, réaffectation
  (prouvé : `flux-wire` 3/3).
- Ref invalidée (timeout/panne) → oubliée (`_fluxForget`), renvoi
  plein : jamais de ref aveugle.

## 4. Budgets appareils

`pack`/`unpack` bornés par `maxCompressMs` (politique) et les bornes
mémoire ci-dessus ; tout dépassement = refus, la tâche M2 survit
(réaffectation). Respect du frein safety : le flux ne place rien,
il n'optimise que le transfert des placements autorisés.
Température/énergie : aucune mesure inventée — [RECHERCHE].

## 5. Limites et [PRÉVU]

- Pas de chiffrement propre au flux (canal M2 réutilisé) ; mTLS [PRÉVU] M4.
- Pas d'exclusion réseau d'un menteur (résultat écarté + pair signalé
  uniquement) ; exclusion [PRÉVU].
- Dimensionnement des bornes (4/2 Mio) vs charges 64 Ko : à valider
  en conditions réelles (LAN, § benchmarks).
- Brotli sans magie fiable : détecté « incompressible » par
  échantillonnage, pas par signature — documenté, non bloquant.

# Jalon M1 — Rapport d'implémentation et de test

> Réseau SnapMesh réellement fonctionnel : 3 processus indépendants qui se
> découvrent, s'authentifient, s'observent et survivent à un kill brutal.
> Tous les chiffres ci-dessous sont mesurés, aucun n'est simulé.

## 1. Choix technologique

**Node.js 24, zéro dépendance externe** (`node:net`, `node:dgram`,
`node:crypto`, `node:http`, `node:test`). Motifs : Ed25519 intégré (aucune
installation, aucun accès réseau extérieur requis), TCP/UDP intégrés,
runtimes disponibles vérifiés (Python 3.14 présent mais sans lib crypto ;
Node v24.14.0 retenu). L'abstraction `Transport` reste prévue : le module
`mesh-net` n'expose que `SnapMeshNode`, les transports BLE / Wi-Fi Direct
s'ajouteront derrière la même interface sans toucher l'ordonnanceur futur.

## 2. Ce qui est implémenté et testé

| Exigence | État | Preuve |
|---|---|---|
| Protocole entre 2–3 processus indépendants | ✅ | test d'intégration, processus réels |
| Découverte LAN (broadcast + multicast, port 47820) | ✅ même hôte | 3 nœuds en **274 ms** (objectif O1 < 10 s) |
| Repli configuration manuelle (`--peers`) | ✅ | test dédié, sans découverte |
| Identité Ed25519, id = empreinte clé publique | ✅ | 9 tests unitaires |
| Échanges authentifiés (HELLO vérifié, seq monotone, fenêtre ±120 s) | ✅ | falsification et usurpation rejetées |
| Heartbeats 1 s, suspect ~3 s, dead ~6 s | ✅ | kill SIGKILL : suspect puis dead observés |
| Reconnexion + identité persistée (fichier clé) | ✅ | redémarrage : même id, reconnecté en ~6,5 s |
| Registre observable (`GET /status`, JSON réel) | ✅ | capacités CPU/RAM/plateforme réelles via `node:os` |
| Démonstration 3 nœuds via CLI | ✅ | `bin/snapmesh-node.js` |

**Résultats réels de la suite** (`node --test`, hors sandbox, 26/10/2026) :
**12 tests, 12 passés, 0 échoué** — 9 unitaires (< 6 ms chacun), manuel+kill
(6,5 s), découverte (0,3 s), robustesse trame poubelle (1 s).

## 3. Limites honnêtes et erreurs rencontrées

1. **Découverte validée sur un seul hôte** (multicast local). Le broadcast
   inter-machines n'a pas été prouvé ici : environnement à une machine.
   Inter-machines = à tester sur matériel réel avec `--bind-host 0.0.0.0`.
2. **Le sandbox de cette session interdit `listen()` TCP** (même loopback ;
   UDP autorisé). Les tests réseau ont exigé une exécution escaladée
   (approbation demandée et obtenue via le mécanisme standard). En usage
   normal, aucune escalade n'est nécessaire.
3. **Écoute par défaut sur 127.0.0.1** (`--bind-host` pour le LAN).
4. **Anti-rejeu partiel** : seq monotone + fenêtre temporelle, pas de
   registre de nonces (suffisant pour M1, à renforcer en M4).
5. **Pas de chiffrement des charges** (signatures seules) et **pas
   d'échange de pairs chiffré** : prévu M4 (mTLS/X25519).
6. **Reconnexion** : pairs manuels réessayés indéfiniment ; pairs découverts
   suivis tant que leur socket vit (pas de re-balayage persistant si
   l'annonce cesse — redécouverte via annonces périodiques).
7. Métrique O3 (95 % sous churn 25 %) **non mesurée** : le mécanisme est
   prouvé (kill → dead → reconnexion), la statistique viendra en M4.

## 4. Prochaines fonctionnalités (M2 et au-delà)

- **M2** : exécution distribuée (`mesh-exec`) + quorum 2/3 (`mesh-verify`) ;
  nouveaux types de messages `TASK`/`RESULT` sur le protocole signé.
- **M3** : `mesh-sched` branché sur `registry.live()` ; Muse propose,
  l'arbitre tranche ; repli round-robin.
- **M4** : mTLS, chiffrement X25519, nonces, suite `mesh-bench` (B0/B1/B2).
- Recherche : Wi-Fi Aware, DHT global, consensus byzantin.

## 5. Points d'extension préparés pour M2/M3

- `SnapMeshNode.snapshot()` / `registry.live()` : source de vérité pour
  l'ordonnanceur (capacités réelles déjà exposées).
- Protocole versionné (`v: 1`) et extensible : ajouter `TASK`/`RESULT`
  sans casser HELLO/HEARTBEAT/BYE/PEERS.
- Événements `peer` / `suspect` / `dead` / `bye` : l'ordonnanceur s'y
  abonnera pour ré-affecter les tâches orphelines.
- CLI `--key` (identité stable) : les nœuds de confiance M4 réutiliseront
  ces identités.

## 6. Consolidation du 2026-10-26 (18/18, même hôte)

Preuve : `bench-logs/validation-m1-20261026.log.txt` (13 unitaires +
5 intégrations : pairs manuels, découverte 272 ms, hostile, fragmenté,
poubelle). Durcissements : trames non-objet rejetées (`bad-frame`),
clé HELLO malformée rejetée (`bad-key`, jamais d'exception), UTF-8
fragmenté reconstitué (StringDecoder), PEERS validés, événement
`message` pour M2, `--discovery-port`, `--status-port`.
Incident : deux suites lancées en parallèle se sont volé les ports
(statut +100 dans la plage TCP voisine) + orphelins de runs tués →
runs invalidés, ports de test isolés (+500), re-runs séquentiels verts.
LAN 2 PC : toujours NON EXÉCUTÉ (procédure + consentement requis).

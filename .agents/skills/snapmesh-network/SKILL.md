---
name: snapmesh-network
description: Concevoir et diagnostiquer le maillage P2P SnapMesh (transport IP, découverte, heartbeat, multi-sauts).
---

# SnapMesh Network

Gère tout ce qui concerne la connectivité pair-à-pair du maillage local et
de l'overlay global.

## Activation

Activer quand la tâche touche : transport (`mesh-net`), découverte de pairs,
heartbeat, routage multi-sauts, BLE / Wi-Fi Direct / Wi-Fi Aware / IP, ou un
diagnostic de connectivité.

## Workflow

1. Identifier le plan concerné : local (prioritaire) ou overlay global.
2. Vérifier que le changement passe par l'abstraction `Transport` (aucun
   couplage direct de l'ordonnanceur au socket).
3. Appliquer les seuils du cahier des charges : découverte < 10 s,
   3 heartbeats manqués = suspect, TTL borné en multi-sauts.
4. Tester sur 2–3 nœuds réels avant de conclure.

## Vérifications obligatoires

- Aucune affirmation radio (BLE, Wi-Fi Direct, Aware) sans capture ou
  journal ; sinon marquer **[RECHERCHE]**.
- Le matériel émulé est étiqueté « émulé ».
- Régression : la découverte et le heartbeat existants passent toujours.

## Livrables attendus

Code documenté du module, test d'intégration multi-nœuds, note au
`docs/JOURNAL.md`, mise à jour du statut **[FONCTIONNEL]** / **[PRÉVU]**.

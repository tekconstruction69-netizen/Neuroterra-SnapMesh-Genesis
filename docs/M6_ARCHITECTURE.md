# M6 — Architecture d'un réseau mondial de calcul IA hétérogène

> Statuts : **[FONCTIONNEL]** testé · **[PRÉVU]** · **[RECHERCHE]**.
> Aucune affirmation radio/réseau sans journal ; matériel émulé étiqueté.

## 1. Décision : hybride, pas de découpage systématique

Cinq modes, choisis par NT-ADAPT 2 (`routeRequest`, `neurocore/src/adapt.js`) :

| Mode | Quand | État |
|---|---|---|
| Model Hosting (modèle entier sur un nœud, bonus si en cache) | Modèle tient en mémoire, chargement amorti | **[FONCTIONNEL]** sélection + exécution graphe même hôte |
| Distributed Compute (tâches indépendantes parallèles) | Ops whitelistées compatibles, bénéfice estimé | **[FONCTIONNEL]** graphe/M2 même hôte ; sockets 2 PC NON EXÉCUTÉS |
| Adaptive Partitioning (coupe conditionnelle) | Seulement si la recherche globale bat le local ≥ marge | **[FONCTIONNEL]** décision (NT-ADAPT) ; gain physique [PRÉVU] |
| Cloud Fallback (Baseten) | Aucun candidat local faisable | **[PRÉVU]** : présence de clé testée, appel jamais exécuté ici ; clé = variable d'environnement uniquement |
| Intelligent Routing (NeuroCore autonome) | Toujours (défaut local si distribution non rentable) | **[FONCTIONNEL]** sans Muse au runtime (fetch espion) |

## 2. Réseau : LAN, P2P Internet, relais — état réel

- **LAN** : transport TCP/IP, découverte broadcast+multicast, heartbeat
  (3 manqués = suspect), registre signé **[FONCTIONNEL même hôte]**.
- **P2P Internet authentifié** : identité NT-ID Ed25519 (l'IP n'est jamais
  une preuve), sessions X25519 éphémères + AES-256-GCM, NT-UCP
  (CERT/NEGOTIATE anti-rejeu) **[FONCTIONNEL même hôte]** ; exposition
  Internet **[PRÉVU]** (aucun nœud publié, aucun scan tiers).
- **Traversée NAT** : **[RECHERCHE]** non implémentée (pas de STUN/TURN,
  pas de journal : aucune promesse).
- **Relais sécurisés** : relais 1-saut signé TASK/RESULT [FONCTIONNEL
  même hôte] ; relais chiffré bout-en-bout et multi-sauts **[PRÉVU]**.
- **Intermittence** : reprise après kill/replan prouvée en local ;
  reconnexion inter-machines **[PRÉVU]** (procédure M6 prête).
- **Abstraction transport** : l'ordonnanceur ne parle jamais au socket
  (il passe par `mesh-net`) ; Wi-Fi Direct/Bluetooth/mobile = interfaces
  **[RECHERCHE]**, aucun pilote livré ni prétendu fonctionnel.

## 3. Moteurs IA et sécurité (inchangés, conservés)

Backends détectés, jamais inventés (NT-COMPAT) ; ONNX Runtime 1.31.1
réel (cpu+dml mesurés, cuda absent ici), JS CPU en repli, accélération
seulement si sonde positive. Adaptateurs llama.cpp/vLLM/OpenVINO :
**[PRÉVU]** optionnels derrière la même sonde (jamais CUDA imposé).
Contrat conservé : NT-UCP + sandbox (ops whitelistées, bornes CPU/RAM/
temps), consentement explicite par appareil, START/STOP et frein
thermique quand la télémétrie existe, signatures + anti-rejeu, reçus —
un reçu prouve l'imputabilité, pas l'exactitude (quorum/re-calcul).
Aucun code arbitraire réseau ; données confidentielles = contrainte
`localOnly`/listes d'appareils autorisés de NT-ADAPT 2.

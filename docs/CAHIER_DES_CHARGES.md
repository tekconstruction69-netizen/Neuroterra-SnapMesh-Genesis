# Neuroterra SnapMesh Genesis — Cahier des charges

> Track : **Push the Frontier** — Meta Global AI Developer Hackathon 2026.
> Statut du document : fondation v1.0. Tout ce qui n'est pas marqué
> **[FONCTIONNEL]** est une intention, pas une affirmation.
> Légende : **[FONCTIONNEL]** = testé et démontré · **[PRÉVU]** = jalon
> hackathon · **[RECHERCHE]** = au-delà du hackathon.

## 1. Énoncé du problème et hypothèse scientifique

### Problème

Des milliards d'appareils hétérogènes (téléphones, portables, postes de
travail, Raspberry Pi, GPU occasionnelles) restent inactifs la plupart du
temps, tandis que le calcul IA reste centralisé, coûteux et dépendant d'une
connectivité stable. Coordonner ces appareils intermittents pour un calcul IA
**fiable et vérifiable** est un problème difficile : churn, hétérogénéité
CPU/GPU/mémoire, partitions réseau, nœuds byzantins, confidentialité des
données.

### Hypothèse scientifique

Un ordonnanceur cognitif propulsé par Meta Muse, combiné à une exécution
déterminsite par validation redondante et à une identité cryptographique
légère, peut atteindre sur un maillage local de 3 à 8 nœuds hétérogènes :

- un taux de complétion des tâches **≥ 95 %** avec un churn de 25 %,
- un surcoût de vérification **< 30 %** du temps de calcul,
- une explication d'ordonnancement traçable pour chaque décision.

Si l'hypothèse est réfutée par les mesures, le repli est un ordonnanceur
déterministe classique (round-robin pondéré par capacité), et Muse reste
cantonné au rôle d'explicabilité.

## 2. État de l'art et différenciation

| Approche existante | Limite | Différenciation SnapMesh |
|---|---|---|
| Folding@home / BOINC | Tâches homogènes, serveur central, pas de vérification forte | Maillage P2P sans serveur, tâches IA hétérogènes |
| Ray / Dask / Celery | Cluster stable supposé, pas de churn | Conçu pour nœuds intermittents, reprise sur panne |
| Golem / Render Network | Blockchain lourde, latence, coût | Vérification légère sans blockchain (signatures + quorum) |
| Hivemind / Petals (LLM distribués) | Pairwise averaging, pas d'ordonnancement général | Ordonnancement cognitif généraliste via Muse |
| FedML / Flower (fédéré) | Agrégation seule, coordinateur central | Exécution de tâches arbitraires + overlay global |

Différenciation clé : **Muse comme planificateur explicable** (pas seulement
un exécutant), validation déterministe par quorum, et transport local
multi-radio (BLE / Wi-Fi Direct / Wi-Fi Aware / IP).

## 3. Objectifs mesurables et critères de succès

| # | Objectif | Critère de succès | Statut |
|---|---|---|---|
| O1 | Découverte locale de nœuds hétérogènes | 3+ nœuds détectés en < 10 s sur LAN | **[FONCTIONNEL]** (même hôte, 274 ms mesurés ; inter-machines à confirmer sur matériel réel) |
| O2 | Exécution distribuée (calcul déterministe M2, puis tâche IA) | Ops déterministes sur ≥ 2 nœuds : **[FONCTIONNEL]** ; inférence/embedding IA réels : **[PRÉVU]** (runtime modèle absent en M2) |
| O3 | Tolérance au churn | ≥ 95 % de complétion avec 25 % de churn | **[PRÉVU]** (mécanisme kill→réaffectation prouvé ; métrique 95 % non mesurée) |
| O4 | Résultats vérifiables | 100 % des résultats signés, quorum 2/3 | **[FONCTIONNEL]** (même hôte ; quorum non-crypto, non anti-collusion) |
| O5 | Apport mesurable de Muse | ≥ 15 % de réduction du makespan vs round-robin | **[PRÉVU]** |
| O6 | Démo 3 minutes | Scénario rejouable de bout en bout | **[PRÉVU]** |
| O7 | Benchmarks publiés | Protocole + baselines + chiffres non inventés | **[PRÉVU]** |

Règle absolue : aucun chiffre de performance n'est annoncé sans le journal
de mesure correspondant (voir [TEST_STRATEGY](TEST_STRATEGY.md)).

## 4. Réseau local P2P et overlay global

**[PRÉVU]** Architecture à deux plans :

- **Plan local (maillage)** : découverte et exécution entre pairs proches,
  latence cible < 50 ms, sans infrastructure.
- **Plan global (overlay)** : DHT de type Kademlia pour l'annuaire
  d'identités et le routage multi-sauts entre maillages distants.

Le plan local est prioritaire pour le hackathon ; l'overlay global est une
maquette (registre signé + relais) sauf avancement supérieur aux prévisions.

## 5. Faisabilité des transports Bluetooth, Wi-Fi Direct, Wi-Fi Aware et IP

| Transport | Portée / débit typique | Faisabilité hackathon | Rôle retenu |
|---|---|---|---|
| BLE (GATT) | ~10 m, ~1 Mb/s | **[RECHERCHE]** (aucune preuve : jamais implémenté ni mesuré) | Signalisation, découverte |
| Wi-Fi Direct | ~200 m, ~250 Mb/s | **[RECHERCHE]** (aucune preuve : jamais implémenté ni mesuré) | Transfert de charges utiles |
| Wi-Fi Aware (NAN) | ~100 m, faible latence | **[RECHERCHE]** (support matériel rare) | Non requis pour la démo |
| IP (TCP/UDP, LAN) | Variable | **[FONCTIONNEL]** (même hôte ; inter-machines : procédure prête, NON EXÉCUTÉ) | Transport principal démontré |

Décision : la démo repose sur **IP/LAN** (reproductible), avec abstraction
de transport permettant d'ajouter BLE / Wi-Fi Direct sans changer
l'ordonnanceur. Toute affirmation radio sera prouvée par capture, sinon
marquée **[RECHERCHE]**.

## 6. Découverte de ressources CPU/GPU hétérogènes

**[PRÉVU]** Chaque nœud publie un descripteur de capacités signé :

- CPU (cœurs, arch), RAM disponible, GPU (modèle, VRAM), batterie/secteur,
  connectivité, version du runtime.
- Annonces périodiques (heartbeat) + expiration en cas de silence.
- Score de capacité normalisé servant d'entrée à l'ordonnanceur.

## 7. Ordonnancement cognitif Muse et validation déterministe

**[PRÉVU]** Deux couches séparées :

1. **Proposition cognitive (Muse)** : à partir des capacités, de la file de
   tâches et de l'historique, Muse propose une affectation et l'explique
   (traçabilité). Appels bornés en temps et en coût, avec budget max.
2. **Validation déterministe** : exécution redondante sur quorum (2/3),
   comparaison de hachages des résultats, vote majoritaire. En cas de
   désaccord : ré-exécution sur nœud de confiance puis exclusion du nœud
   fautif.

Garde-fou : si Muse est indisponible, bascule automatique sur ordonnanceur
déterministe (repli testé, voir [ARCHITECTURE](ARCHITECTURE.md)).

## 8. Exécution distribuée des tâches

Cycle de vie : soumission → affectation → exécution → collecte → validation.
**[FONCTIONNEL]** (M2, même hôte) : 6 opérations déterministes en liste blanche
(`fib`, `primes`, `sha256-hex`, `wordcount`, `sort-int`, `matmul`), file UUID
persistée, quorum ceil(2n/3). **Distinction explicite** : ce n'est PAS de
l'inférence IA (aucun modèle, aucun embedding) — la vérification par
re-calcul/quorum n'est possible que parce que les ops sont déterministes.
**[PRÉVU]** : inférence de modèles légers, embeddings, traitement d'images
par lots (exigent un runtime modèle + tolérance numérique, absents en M2).

## 9. Identité cryptographique et résultats vérifiables

**[PRÉVU]** : paire de clés Ed25519 par nœud, identifiant = empreinte de la
clé publique ; tous les messages signés (découverte, affectation, résultat).
Chaîne de traçabilité : `hash(tâche) → assignation signée → résultats
signés → quorum`. Pas de blockchain pour le hackathon (surcoût injustifié).

## 10. Tolérance aux pannes, reprise et routage multi-sauts

**[PRÉVU]** : détection de panne par heartbeat (3 manqués = suspect),
ré-affectation des tâches orphelines, idempotence des tâches (rejouables
sans effet de bord), persistance minimale de la file. Routage multi-sauts :
retransmission signée de proche en proche, limite TTL, maquette sur 3 nœuds.

## 11. Sécurité, confidentialité et limites de ressources

- **Sécurité [PRÉVU]** : TLS mutuel entre pairs, sandbox d'exécution
  (quotas CPU/RAM/temps, pas d'accès réseau sortant par défaut).
- **Confidentialité [PRÉVU]** : chiffrement des charges utiles de bout en
  bout (clés éphémères X25519), option « nœuds de confiance uniquement ».
- **Limites [PRÉVU]** : chaque nœud déclare un budget (ex. 2 cœurs, 1 Go,
  10 min/h) ; l'ordonnanceur ne le dépasse jamais ; coupe-circuit global.
- **Clés API [RÈGLE]** : jamais dans le dépôt ; variables d'environnement +
  `.env.example` ; toute fuite = rotation immédiate.

## 12. Jalons de développement réalistes

| Jalon | Contenu | Statut |
|---|---|---|
| M0 | Fondation (ce dossier, skills, règles) | En cours |
| M1 | Transport IP + découverte + heartbeat (2–3 nœuds LAN) | **[PRÉVU]** premier jalon d'implémentation |
| M2 | Exécution distribuée + quorum de validation | **[PRÉVU]** |
| M3 | Ordonnanceur Muse + repli déterministe | **[PRÉVU]** |
| M4 | Sécurité (mTLS, sandbox, budgets) + benchmarks | **[PRÉVU]** |
| M5 | Démo 3 minutes rejouable + dossier de soumission | **[PRÉVU]** |

## 13. Exigences de la démonstration live (3 minutes)

Voir [DEMO_PLAN](DEMO_PLAN.md). Exigences minimales : 3 nœuds hétérogènes
réels ou émulés localement, tâche IA visible, panne injectée avec reprise,
preuve de vérification affichée, aucune mesure inventée à l'écran.

## 14. Méthodologie de benchmark et baselines

Voir [TEST_STRATEGY](TEST_STRATEGY.md). Baselines obligatoires : exécution
locale mono-nœud, round-robin sans Muse, et exécution centralisée simulée.
Métriques : makespan, taux de complétion sous churn, surcoût de vérification,
temps de reprise. Chaque chiffre publié est accompagné du protocole, du
matériel réel et du journal brut.

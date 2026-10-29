# Neuroterra SnapMesh Genesis — Architecture

> Principe directeur : **un système démontrable plutôt que des affirmations
> non prouvées**. Chaque composant indique son statut : **[FONCTIONNEL]**,
> **[PRÉVU]**, **[RECHERCHE]** (voir
> [CAHIER_DES_CHARGES](CAHIER_DES_CHARGES.md)).

## 1. Vue d'ensemble

Système pair-à-pair où des nœuds hétérogènes annoncent leurs ressources,
reçoivent des tâches IA d'un ordonnanceur assisté par Muse, exécutent en
sandbox et retournent des résultats signés validés par quorum.

```
            ┌──────────────┐
            │  Client / CLI │  soumet tâches, lit résultats
            └──────┬───────┘
                   ▼
┌─────────────────────────────────────────┐
│             Plan de contrôle             │
│  Découverte ─ Ordonnanceur ─ Validateur  │
│  (Muse propose, le déterministe dispose) │
└──────┬──────────────┬─────────┬─────────┘
       ▼              ▼         ▼
 ┌─────────┐   ┌──────────┐  ┌──────────┐
 │ Nœud A  │◄─►│ Nœud B   │◄─►│ Nœud C   │  plan d'exécution
 │ CPU     │   │ GPU      │   │ mixte    │  (maillage P2P)
 └─────────┘   └──────────┘  └──────────┘
```

## 2. Modules et responsabilités

| Module | Rôle | Interface clé | Statut (périmètre preuve : même hôte, loopback) |
|---|---|---|---|
| `mesh-net` | Transport TCP/IP, découverte (broadcast+multicast), heartbeat, registre | `SnapMeshNode`, `GET /status` | **[FONCTIONNEL]** (M1 37/37 : 18 + 6 session + 5 transport + 8 intégration) |
| `mesh-session` (§3) | Sessions X25519 éphémères + AES-256-GCM (SESSION-KEY/ENCRYPTED), relais 1-saut TASK/RESULT (RELAY) | `sendEncrypted()`, `sendRelayVia()`, `sealFor()` | **[FONCTIONNEL]** (session 6/6, transport 5/5, e2e chiffré 1/1) ; relais chiffré bout-en-bout et multi-sauts **[PRÉVU]** |
| `mesh-caps` | NT-CAP : profil versionné signé (CPU/GPU/NPU/RAM/transports), RTT + RAM live, limites utilisateur | `caps()` | **[FONCTIONNEL]** (même hôte) ; GPU/NPU jamais inventés ; score **[PRÉVU]** (M3) |
| `mesh-sched` | Ordonnanceurs local/round-robin/capacity/muse (interface `pick` commune) ; arbitre déterministe + heuristique validée + repli | `pick()` ; `musePropose()` | **Partiel** : 4 ordonnanceurs **[FONCTIONNEL]** (même hôte, comparatif vert), appel Muse live **[PRÉVU-live]** (code présent, repli prouvé) |
| `mesh-exec` | Ops en liste blanche (6, bornées), file UUID persistée, timeouts, réaffectation, reprise | `submit()`, TASK/RESULT v1 | **[FONCTIONNEL]** (M2 47/47) ; TASK/RESULT chiffrés quand canal prêt (§3) ; exécution réseau en worker borné (§4, `osSandbox:false`) ; sandbox OS fort **[PRÉVU]** |
| `mesh-frag` (§5) | DAG v1 (deps, `$ref`∈deps, minRes cpus+RAM, expiry, merge nommé), vagues parallèles, presets chaîne/batch/découpe | `submitDag()`, `build*` | **[FONCTIONNEL]** (9/9 + 3/3 e2e, même hôte) ; tokens LLM non fragmentables (pas d'inférence), merge = fonctions nommées uniquement |
| `mesh-verify` (§7) | Quorum ceil(2n/3), re-calcul local (r=1), dissidents signalés + reçus signés vérifiés pré-vote + faisceau job (empreintes, `finalHash`) | `decide()` ; `verifyReceipt()` | **[FONCTIONNEL]** (même hôte) ; exclusion auto **[PRÉVU]** (M4) — reçu = imputabilité, PAS exactitude ; 2/3 ni preuve crypto ni anti-collusion |
| `mesh-identity` | NT-ID : Ed25519, id = empreinte, défi de session, nonce anti-rejeu, révocation, renouvellement, TOFU | `sign()`, `verify()` | **[FONCTIONNEL]** (même hôte) ; mTLS/confiance/DPAPI **[PRÉVU]** (M4) |
| `mesh-bench` | Harnais (`--scheduler`, `--submit-count`, journaux bruts) ; protocole B0/B1/B2 | flags CLI, `bench-logs/` | **Partiel** : harnais **[FONCTIONNEL]**, benchmarks **[PRÉVU]** (M4) |
| `mesh-app` (§§8-9) | PWA loopback START/STOP + profil NT-ID, NT-CAP, graphe temps réel, soumission job → réponse vérifiée ; frein contrôleur sur tout placement (Muse inclus) | `/api/job`, `/api/state` | **[FONCTIONNEL]** (même hôte, 6/6 API) ; STOP annule l'en-vol local |
| `mesh-demo` | Scénario 3 minutes rejouable, panne injectée | `demo.sh`, `checklist` | **[PRÉVU]** (M5) |

Règles de modularité : un module = un dossier, API documentée, dépendances
unidirectionnelles (`sched` ne parle jamais directement au transport ;
il passe par `mesh-net`).

## 3. Flux principaux

**Soumission → résultat** : client → file persistée → `propose()` (Muse,
borné) → `assign()` (arbitre vérifie budgets et signatures) → exécution
redondante (quorum) → `vote()` → résultat agrégé signé → client.

**Panne** : 3 heartbeats manqués → nœud suspect → tâches orphelines
ré-affectées (idempotence) → réintégration ou exclusion après challenge.

**Dégradation Muse** : timeout ou erreur → bascule sur round-robin pondéré,
événement journalisé, la démo continue.

## 4. Données et persistance

File de tâches persistée (reprise après crash), registre d'identités signé,
journal d'audit des décisions d'ordonnancement (entrée Muse + décision
finale). Aucune donnée personnelle ; TASK/RESULT chiffrés (X25519 éphémère +
AES-256-GCM) quand le canal est prêt, sinon clair signé signalé (`enc:false`) ;
relais en clair signé. Rétention minimale pour rejouer une mesure.

## 5. Choix structurants (résumé)

Détails et alternatives rejetées dans [TECHNICAL_DECISIONS](TECHNICAL_DECISIONS.md) :
transport IP d'abord, quorum plutôt que blockchain, Ed25519 + mTLS,
sandbox avec quotas stricts, Muse conseiller (jamais décideur unique).

## 6. Ce qui est explicitement hors scope du hackathon

Consensus byzantin complet, Wi-Fi Aware productif, overlay DHT global
complet, exécution GPU multi-fabricants optimisée, fédération
multi-organisations : tous **[RECHERCHE]**.

# AUDIT — Matrice des exigences → code → preuve

> Statuts : IMPLEMENTÉ_TESTÉ_LOCAL · IMPLEMENTÉ_NON_TESTÉ · PARTIEL ·
> ABSENT · PLATEFORME_INCOMPATIBLE · RECHERCHE. Tout le code cité a été
> écrit pendant le hackathon (voir `docs/COMPLIANCE.md`), sauf mention.

| ID | Exigence | Statut | Preuve / écart |
|---|---|---|---|
| UX-01 | Accueil 3 onglets | IMPLEMENTÉ_NON_TESTÉ | `mesh-app/public/index.html` ; test navigateur NON rejoué ici |
| UX-02 | Vision premium + tech | IMPLEMENTÉ_NON_TESTÉ | idem ; pas de test visuel automatisé |
| UX-03 | Mon appareil + diagnostics | IMPLEMENTÉ_NON_TESTÉ | ids 65/65 présents, syntaxe OK |
| UX-04 | Réglages persistants, batterie 25 % | IMPLEMENTÉ_TESTÉ_LOCAL | garde batterie en unitaire (mesure simulée étiquetée) |
| HW-01 | Analyse navigateur réelle | IMPLEMENTÉ_TESTÉ_LOCAL | logique relue ; 41–65 ids vérifiés |
| HW-02 | Sonde système Windows honnête | PARTIEL | `sysinfo.js` (non committé) ; CIM refusé ici → NA correct |
| HW-03 | Thermique mesurée | ABSENT | Non disponible sans privilèges ; politique conservatrice affichée |
| ID-01 | NT-ID, signatures, anti-rejeu | IMPLEMENTÉ_TESTÉ_LOCAL | M1 37/37 (historique, même hôte) |
| NET-01 | Discovery LAN TCP/IP | IMPLEMENTÉ_TESTÉ_LOCAL | M1, même hôte |
| NET-02 | Bluetooth / BLE transport | ABSENT | Rien dans le code ; UI le déclare |
| NET-03 | Wi-Fi Direct transport | ABSENT | Sonde pilote seule ; non compatible affiché |
| NET-04 | NAT / relais chiffré / multi-sauts | RECHERCHE | Relais 1-saut simple seul |
| PWA-01 | Installable iOS/Android | PARTIEL | Manifeste + icônes + SW présents ; installation réelle NON VÉRIFIÉE |
| WRK-01 | Worker natif Windows | IMPLEMENTÉ_TESTÉ_LOCAL | `compute-node.js`, M5/M6 procédure prête, 2 PC NON EXÉCUTÉS |
| WRK-02 | START/STOP + STOP prioritaire | IMPLEMENTÉ_TESTÉ_LOCAL | safety 21/21 (ce jour, unitaire) |
| WRK-03 | Batterie faible refuse START | IMPLEMENTÉ_TESTÉ_LOCAL | Unitaire (télémétrie injectée [SIMULÉ]) |
| LIM-01 | Limites CPU/RAM/GPU/VRAM | PARTIEL | CPU coopératif + sandbox 64 Mo réels ; GPU/VRAM déclaratifs ; `setTargets` désormais strictement validé (P0-2, testé) |
| SBX-01 | Sandbox + `shutdown()` réel | IMPLEMENTÉ_TESTÉ_LOCAL | Bornes + arrêt réel testés (P0-1 : threads tués, post-arrêt refusé, 27/27 calcul) |
| UCP-01 | NT-UCP CERT/NEGOTIATE | IMPLEMENTÉ_TESTÉ_LOCAL | 4/4 + PoC hétérogène |
| ADP-01 | NT-ADAPT/2 routage + repli | IMPLEMENTÉ_TESTÉ_LOCAL | 16/16 neurocore |
| CMP-01 | NT-COMPAT détection honnête | IMPLEMENTÉ_TESTÉ_LOCAL | 5/5 |
| FUS-01 | NT-FUSION graphe + exécution | IMPLEMENTÉ_TESTÉ_LOCAL | 7/7 |
| FLX-01 | NT-Flux compression mesurée | IMPLEMENTÉ_TESTÉ_LOCAL | 7/7 (+flux-wire) |
| MUS-01 | NeuroCore sans Muse au runtime | IMPLEMENTÉ_TESTÉ_LOCAL | Test fetch espion |
| ENC-01 | Sessions chiffrées, relais signé | IMPLEMENTÉ_TESTÉ_LOCAL | session 6/6, e2e chiffré 1/1 (même hôte) |
| QUO-01 | Quorum + reçus (non-preuve) | IMPLEMENTÉ_TESTÉ_LOCAL | M2 63/63 (menteur écarté) |
| FRG-01 | Fragmentation/agrégation DAG | IMPLEMENTÉ_TESTÉ_LOCAL | 9/9 + e2e |
| ONNX-01 | Modèles ONNX réels | IMPLEMENTÉ_TESTÉ_LOCAL | ORT 1.31.1 cpu+dml mesurés, cuda absent |
| GPU-01 | Orchestration GPU/CPU/NPU | PARTIEL | Sélection par sondes ; exécution GPU/NPU NON démontrée |
| REG-01 | Registre global persistant | IMPLEMENTÉ_TESTÉ_LOCAL | nt-registry 3/3 ; sync Supabase PRÉVU |
| SUP-01 | Supabase | ABSENT | Sélection par env seule, aucun appel |
| NET-05 | Netlify statique + fonctions | IMPLEMENTÉ_TESTÉ_LOCAL | Déploiement vérifié HTTPS (rapport 29/10) |
| GH-01 | Dépôt public conforme | PARTIEL | Public et déployé, mais 6 fichiers + 9 non suivis en attente de revue |
| SEC-01 | API locale (Origin, token, 413, traversal) | IMPLEMENTÉ_TESTÉ_LOCAL | Gardes 2/2 + revue statique saine |
| SEC-02 | Aucun secret publié | IMPLEMENTÉ_TESTÉ_LOCAL | Scanner propre, index vérifié |
| PKG-01 | Packaging Windows installable | PARTIEL | Scripts PS validés syntaxiquement ; installation réelle NON EXÉCUTÉE |

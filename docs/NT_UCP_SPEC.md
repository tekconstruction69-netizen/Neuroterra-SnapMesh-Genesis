# NT-UCP — Universal Trust & Compute Compatibility Protocol

> Couche de compatibilité universelle : négociation authentifiée des
> capacités + IR portable + exécution hétérogène validée.
> Vérifié : M2 32/32 rejoué avant ce module. Statuts : [FONCTIONNEL]
> testé · [PRÉVU] · [RECHERCHE].

## 1. Hypothèse et positionnement

Négocier (cryptographiquement) QUI peut QUOI, puis placer une IR
portable au coût total : c'est l'assemblage, éprouvé pièce par pièce
(M1/M2, NT-COMPAT, FUSION, NT-Flux, NT-PQ), qui est nouveau — pas les
pièces (cf. `PRIOR_ART_AND_NOVELTY.md`). Aucune unicité revendiquée.

## 2. Les 9 piliers — état réel

| Pilier | État | Preuve |
|---|---|---|
| 1. NT-ID (pseudonyme, défi/session) | ✅ réutilisé (mesh-net) | M1 37/37 |
| 2. NT-CERT (manifeste signé) | ✅ nouveau (`nt-ucp/src/cert.js`) | 4/4 (falsifié rejeté, nodeId = empreinte 64 hex) |
| 3. NT-NEGOTIATE (versions, dtypes, codecs, crypto) | ✅ nouveau (`negotiate.js`) | accord bilatéral, rejeu refusé, sans-intersection motivée, `neg-disagree` |
| 4. NT-IR (graphe typé) | ✅ réutilisé (nt-fusion) | 7/7 |
| 5. NT-ADAPTER (runtimes + casts) | ✅ réutilisé (nt-compat) | 5/5 |
| 6. NT-PQ (hybride éprouvé) | ✅ réutilisé (nt-pq) | 6/6 ; `pq-hybrid/1` négocié si bilatéral |
| 7. NT-MUSE (plan hétérogène) | ✅ réutilisé | mock arbitré 7/7 |
| 8. NT-VALIDATOR (avant exécution) | ✅ réutilisé | tout plan re-validé ( PoC : 2/2 `ok`) |
| 9. NT-SAFETY (budgets + STOP) | ⚠️ partiel : budgets déclarés respectés (plafonds registres) ; contrôleur matériel câblé M2 mais non exercé ici | budgets vérifiés, STOP hors périmètre PoC (documenté, pas simulé) |

## 3. PoC : protocole et mesures

`node scripts/bench-ntucp.js --reps 3` → `bench-logs/ntucp-poc-20261026.json`.
Deux profils logiciels (wA complet, wB sans int8) sur CETTE machine —
pas deux appareils. Tâche : (A×B) fp32 → int8 → (×C) → fp32 → (+D),
24×24, oracle indépendant.

- Négocié : `{fusion-ir/1, fp32, gzip, x25519}` en **1,30 ms, 2353 o** ;
  certificats émis en 3,05 ms (2× Ed25519 + manifestes).
- Placements greedy = muse-repli : `{mm,A,B}` sur wB (flops mesurés
  supérieurs), `{qi,C,mm2,qf,out,D}` sur wA (seul avec int8) —
  nœuds int8 contraints prouvés sur wA. Une jambe : mm→qi, 2304 o.
- Bras (méd. /3) : mono 0,64 ms · greedy 0,28 ms · muse 0,29 ms —
  écarts NON significatifs (sub-ms, workers logiques) : seule
  l'exactitude et les octets sont interprétables.
- Conversions (casts) : ~0,05–0,08 ms. Transferts : 2304 o, NT-Flux
  → 2304 o (tenseurs denses : `raw`, estimation pack ~1–2 ms pour
  décider de ne pas compresser — coût de décision documenté).
- Exactitude : erreur max 40,1 sur pic 2874 (**1,40 % relatif**) —
  quantification int8 sur grande dynamique, conforme à la théorie
  (quantum × accumulation) ; pas de claim < 0,1 % au-delà du 2×2 testé.
- Registre : 3/3 vérifié (négociation, plan, résultat).

## 4. Interopérabilité ≠ instructions (avertissement)

Un accord NT-NEGOTIATE prouve que deux manifestes AUTHENTIQUES
s'accordent sur des NOMS (dtypes, backends, protocoles). Il ne prouve
PAS que le pair exécute réellement ces instructions (un manifeste
menteur passe l'arbitrage). La confiance d'exécution vient des reçus
+ re-calcul/quorum (§7), jamais de la négociation seule. Testé :
cert falsifié rejeté ; pair menteur sur capacités = NON couvert
([PRÉVU] : attestation, exécution d'épreuve).

## 5. Limites et suite

Fil simulé (TCP réel : `flux-e2e` hors sandbox) ; 2 appareils, LAN,
GPU/NPU, onnxruntime, Muse live : NON démontrés. PQ : pas de
« quantum-safe » sans audit. Blockchain : [PRÉVU] optionnel.
Prochaine étape : négociation sur sockets réels + attestation par
épreuve d'exécution.

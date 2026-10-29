# NT-FUSION — Expériences A–E

> Protocole : `node scripts/bench-ntfusion.js --reps 5 --out
> bench-logs/ntfusion-abcde-20261026.json`. Graphe réel : (A×B) fp32
> 32×32 → cast int8 → (×C) int8 → cast fp32 → (+D). Exécutions réelles
> (5/5 partout), intégrité vérifiée, panne injectée récupérée (retry).
> Rapport JSON : `bench-logs/ntfusion-abcde-20261026.json`.

## 1. Résultats (médianes, 5 reps, ce poste)

| Bras | Stratégie | Réussite | Temps méd. | Transferts | Mémoire |
|---|---|---|---|---|---|
| A | 1 worker local | 5/5 | 0,96 ms | 0 o | +1,8 Mo max obs. |
| B | round-robin 2 workers | 5/5 | 0,35 ms | 10240 o | (inclus) |
| C | greedy capacités | 5/5 | 0,32 ms | 0 o | (inclus) |
| D | Muse-repli (sans clé) | 5/5 | 0,33 ms | 0 o | (inclus) |
| E | B + NT-Flux (octets tenseurs réels) | 5/5 | 0,35 ms | 10240 → **7217 o** (×1,4 ; 2 raw + 2 gzip) | (inclus) |

Récupération : panne injectée sur `mm2` → retry → succès (OK).

## 2. Lecture honnête

- Les temps sub-ms NE différencient PAS les stratégies (bruit >
  écarts sur 32×32) : aucune allégation de vitesse. La
  différenciation porte sur les OCTETS transférés et la validité.
- C et D placent tout en local (workers équivalents) : 0 transfert =
  décision optimale, pas échec de planification. B force l'alternance
  (10240 o) : E montre le gain NT-Flux réel sur tenseurs denses
  (×1,4 — les tenseurs denses compressent peu, cf. NT_FLUX).
- Muse live : NON appelé (aucune clé) ; le repli heuristique validé
  fait jeu égal au greedy ici (normal : même information, même
  machine). Un avantage Muse n'est attendu qu'avec hétérogénéité
  réelle (workers asymétriques, réseau mesuré, pannes).
- Workers = 2 registres de CETTE machine (processus locaux), pas
  2 appareils. Transferts = octets comptés ; le fil réel est prouvé
  par §5/e2e, pas re-mesuré ici. LAN 2-PC : NON EXÉCUTÉ.

## 3. Reproduction

Mêmes commandes, mêmes seeds (données construites, pas d'aléa) :
écarts attendus ±bruit sub-ms sur temps, octets EXACTS (déterminisme
testé : tenseurs, plans, packs).

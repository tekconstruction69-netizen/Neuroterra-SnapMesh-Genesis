# 05 — Plan expérimental et critères de réfutation

## Protocole figé (benchmark-lab)

Charge : presets déterministes `mixed-fp32-int8` et `batch-add`
(`buildPreset`, aucune graine). Répétitions : 7 (≥ 5). Baselines au niveau
graphe : **B0** mono-worker, **B1** round-robin aveugle, **B2** NeuroCore
actuel (glouton appris, apprenant frais), **B3** NT-ADAPT (global
pessimiste + épreuves). B2g (greedy nt-fusion, lien connu) en ablation.
Harnais : `scripts/bench-ntadapt.js` ; journal brut JSON horodaté avec
en-tête machine. Les baselines historiques mesh-compute (fib, sockets
loopback) restent inchangées et ne sont pas rejouées ici.

Scénarios : **S1** chaîne mixte n=32, wB fp32 ×8 sans int8, lien
256 Kio/s — asymétries **ÉMULÉES** sur registres (décision éprouvée, pas
le matériel) ; **S2** symétrique n=16 (repli local attendu) ; **S3**
`batch-add` n=16, plafond **ÉMULÉ** 6000 o/worker (mémoire cumulée).
Endpoint primaire : affectations, octets transférés, faisabilité
(validatePlan + cumul), makespan du modèle. Endpoint secondaire :
exactitude vs B0 (`verifyTolerance` fp32) et temps d'exécution local —
sub-ms, **non** interprétable comme gain réseau. Énergie : non mesurée
(aucun capteur fiable), rapportée `null`.

## Critères de réfutation (avant de regarder les résultats)

- H1 réfutée si, sur S1, B3 transfère autant que B2/B2g, ou si sur S3 B3
  accepte un plan cumulativement infaisable, ou si le repli S2 n'est pas
  local. H1 réfutée aussi si les temps de planification B3 dépassent le
  gain modèle sur la majorité des scénarios.
- H2 réfutée si l'amorçage par épreuves ne réduit pas l'erreur du modèle
  (comparer makespan modèle B3 sans/avec épreuves au même assignment).
- H3 réfutée si `verifyTolerance` accepte une faute de +10 % ou rejette
  l'arrondi fp32 inter-backends (< 1e-6 relatif mesuré M2), ou si la
  compression mesurée choisit le compressé sur tampon aléatoire.
- Toute exécution de plan invalide par B3 (validatePlan faux) = échec
  bloquant, quel que soit le reste.

## Reste à exécuter [PRÉVU]

Deux appareils physiques (procédure M6 prête, NON EXÉCUTÉE : matériel +
deux opérateurs requis) ; charges ≥ 10 ms et workers réellement
asymétriques pour H2 ; sockets réels pour convertir les octets comptés
en temps réseau mesurés ; panne en cours d'exécution distribuée via le
pont M2 (déjà prouvée en local par `flow.js`, à rejouer sur 2 processus).
Ne jamais présenter deux processus d'une machine comme deux appareils.

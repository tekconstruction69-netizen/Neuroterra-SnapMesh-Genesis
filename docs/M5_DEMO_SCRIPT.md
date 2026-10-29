# M5 — Script demo 3 minutes (jury, reproductible)

> Duree totale : 180 s. Chaque scene a un minuteur et un repli.
> Toute fonctionnalite non demontree est EXCLUE de la video ou annoncee
> comme prototype. Aucun revenu, aucun GFLOPS theorique, aucun gain invente.

## Acteurs

- PC-A : NeuroCore + 1 worker local (ou coordinateur seul en LAN).
- PC-B : worker distant (si absent : 2e worker local, ANNONCE comme local).
- Ecran : UI Genesis (`mesh-app`) ou console `/status` + journaux.

## Deroule (secondes cumulees)

1. **0-20 — Rejoindre.** Lancer les 2 workers + coordinateur (1 commande
   par PC, cf. `docs/M5_LAN_TEST_PROCEDURE.md`). Montrer `peers: 2`,
   `sessionVerified`. Repli : `M5-PREFLIGHT` vert a l'ecran.
2. **20-45 — Capacites.** Afficher NT-CERT des pairs (CPU/threads, RAM,
   EPs ORT sondes : cpu/dml). Ne citer QUE le mesure.
3. **45-100 — Calcul IA reel.** Soumettre `batch-fib [20,25,30]` (ou graphe
   FUSION via pilote). Montrer : fragments → workers, verdict `done`,
   valeurs exactes, empreinte finale.
4. **100-130 — Distribution.** Graphe des affectations NeuroCore + une
   decision expliquee (`[plan] … conf=…`). Comparaison : meme job en
   round-robin (1 ligne de bench).
5. **130-155 — Panne.** Kill brutal d'un worker a l'ecran → `suspect→dead`
   (~6 s) → reprise, verdict exact sans perte. Si le timing depasse,
   montrer le journal `[reprise]` plutot que d'attendre en direct.
6. **155-170 — Mesures.** Tableau reel : latence, octets, erreur 0 (ORT),
   surcharge orchestrateur. Une seule comparaison chiffree : A vs B/C.
7. **170-180 — Cloture.** STOP (prioritaire), limites affichees, phrase :
   « 2 processus locaux sauf mention LAN ; scripts et journaux publics. »

## Preuves a garder de la prise

`bench-logs/m5-*` du jour + `M5-RAPPORT-*.md` genere par `M5-REPORT.ps1`.

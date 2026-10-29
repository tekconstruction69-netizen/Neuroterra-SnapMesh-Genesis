# Contrats du futur orchestrateur Muse (M3) — PHASE C

> État §6 : adaptateur + arbitre + heuristique **implémentés et testés**
> (`mesh-compute/src/muse.js`, ordonnanceur `muse`, comparatif mêmes-conditions
> vert). Appel distant réel : code présent, **non exercé en live** (aucune clé,
> aucun réseau externe dans cet environnement) — son repli est prouvé par
> stubs. **Aucun avantage de performance n'est affirmé** : O5 reste une
> hypothèse à mesurer (§10).

## 1. Rôle (rappel D3)

Muse **propose**, l'arbitre déterministe **dispose** : chaque proposition
est validée (budgets, signatures, bornes) et peut être refusée avec repli
round-robin. Le repli est déjà le comportement par construction (les
ordonnanceurs déterministes ci-dessous tournent sans Muse).

## 2. Contrat d'entrée (construit depuis `snapshot()` + file)

```json
{
  "v": 1,
  "at": "<ISO-8601>",
  "nodes": [
    {"id": "<hex64>", "name": "n1", "cpus": 16, "freeMem": 5113196544,
     "load": 2, "state": "connected", "lastSeenAgoMs": 120}
  ],
  "queue": [
    {"taskId": "<uuid>", "op": "fib", "args": {"n": 30},
     "redundancy": 3, "timeoutMs": 8000, "state": "pending"}
  ],
  "history": [
    {"taskId": "<uuid>", "op": "fib", "scheduler": "round-robin",
     "makespanMs": 1410, "outcome": "done", "attempts": 3}
  ],
  "budgets": {"maxCalls": 10, "timeoutMs": 5000}
}
```

Champs `load` = affectations en cours (vue coordinateur) ; `history` =
tâches soldées récentes (verdicts + makespan mesurés, jamais estimés).

## 3. Contrat de sortie (proposition Muse → arbitre)

```json
{
  "v": 1,
  "assignments": [{"taskId": "<uuid>", "executors": ["<hex64>", "<hex64>"]}],
  "explanation": "n1+n2 : 16 CPU libres chacun, charge 0 ; redondance 2.",
  "confidence": 0.8,
  "fallback": "round-robin"
}
```

Règles de l'arbitre (refus → `fallback`) : exécutants inconnus ou non
`connected` ; redondance hors 1..5 ; args hors bornes de `OPS` ;
`confidence` < 0,5 ; timeout/dépassement de `budgets`. Tout refus est
journalisé avec la proposition d'origine (audit).

## 4. Paramètres de comparaison équitable (M4/benchmark-lab)

Quatre ordonnanceurs, **même interface** `pick(task, candidates, state)` —
déjà réalisée en M2 (`mesh-compute/src/sched.js`) :

| Ordonnanceur | Statut | Paramètres |
|---|---|---|
| `local` (B0) | ✅ implémenté | aucun |
| `round-robin` (B1) | ✅ implémenté | aucun |
| `capacity` | ✅ implémenté | score = cpus / (1 + load) |
| `muse` | **Partiel §6** : `heuristic` validée **[FONCTIONNEL]** (même hôte), appel distant (clé/URL explicites) **[PRÉVU-live]** — code présent, repli prouvé, jamais exercé en live ici | contrats §2–§3 + `budgets` |

Protocole de comparaison (à exécuter en M4, pas avant) : même charge
(ops × N fixés, seed fixée), mêmes nœuds, ≥ 5 répétitions, métriques
makespan / complétion / appels Muse (nombre, latence) ; publier
moyenne + écart-type + N avec journaux bruts. Le CLI `--submit-count N`
et `--scheduler <nom>` servent déjà de harnais.

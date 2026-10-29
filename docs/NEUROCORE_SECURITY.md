# NeuroCore — Sécurité

## 1. Invariants (testés)

- STOP/frein : consulté avant placement ET exécution (P8) ; fermé ⇒
  `refused` propre, autre worker cherché, sinon échec signalé —
  jamais de contournement par l'ordonnanceur (test frein).
- Pas de code arbitraire : presets + graphe validé, kinds fermés,
  whitelist `ops.js` + tenseurs bornés (P3 : args hostiles sans effet).
- Mémoire : plafond registre (moitié RAM libre), tas worker 64 Mo,
  résultat 1 Mio, historique learner 500, journal 100, preuves 500.
- Concurrence : workers bornés (`sandbox-busy`), budgets safety.
- Identités/messages : NT-ID/NT-CERT/NT-UCP + PQ composé ; signatures
  ≠ preuve de calcul (quorum/re-calcul §7).

## 2. Limites nommées

- Thermique/batterie : sondes indisponibles ici → proxy + conservateur,
  jamais inventé. Pas de plafonnement matériel revendiqué.
- Pas de sandbox OS ; `process.env` lisible dans les workers : aucun
  secret n'y transite (clés Muse jamais sur les workers).
- TOFU réseau, pas d'exclusion auto du menteur, mTLS [PRÉVU] (M4).
- App Genesis inchangée (START/STOP, modes, résultats vérifiés) :
  l'utilisateur ne voit pas NeuroCore, seulement ses garanties.

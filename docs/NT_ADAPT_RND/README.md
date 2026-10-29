# NT-ADAPT R&D — Index

> Mission NT-ADAPT (Meta Global AI Developer Hackathon 2026, Push the Frontier).
> Statuts : **[FONCTIONNEL]** testé · **[PRÉVU]** · **[RECHERCHE]**.
> Aucune performance, originalité mondiale ni fonctionnalité non démontrée
> n'est revendiquée. Matériel émulé toujours étiqueté « ÉMULÉ ».

| # | Document | Contenu |
|---|---|---|
| 01 | [01-etat-de-l-art.md](01-etat-de-l-art.md) | Audit Genesis + travaux existants comparés |
| 02 | [02-hypotheses-nouveaute.md](02-hypotheses-nouveaute.md) | 3 problèmes, 3 hypothèses, nouveauté vérifiable |
| 03 | [03-protocole-contrats.md](03-protocole-contrats.md) | Protocole et contrats de compatibilité |
| 04 | [04-architecture-ordonnanceur.md](04-architecture-ordonnanceur.md) | Moteur autonome NeuroCore + NT-ADAPT |
| 05 | [05-plan-experimental.md](05-plan-experimental.md) | Plan expérimental et critères de réfutation |
| 06 | [06-resultats.md](06-resultats.md) | Résultats reproductibles et lecture honnête |
| 07 | [07-limites-risques.md](07-limites-risques.md) | Limites, risques, travaux restants |

Prototype : `neurocore/src/adapt.js`, intégration `neurocore/src/flow.js`
(`strategy:'adapt'`, défaut `legacy` inchangé), tests
`neurocore/test/adapt.test.js`, bench `scripts/bench-ntadapt.js`,
journal brut `bench-logs/ntadapt-2026-10-29.json`.

Expérience retenue (argumentée en 02) : **partition globale + épreuves
mesurées** — la seule réfutable dès maintenant sur une machine, avec des
endpoints (affectations, octets, faisabilité) insensibles au bruit sub-ms.

# Neuroterra SnapMesh Genesis — Décisions techniques

> Chaque décision suit le format : contexte → décision → alternatives
> rejetées → comment la révoquer (signal mesuré).

## D1. Transport principal : IP/TCP+UDP sur LAN

Contexte : 4 radios candidates, temps hackathon limité.
Décision : démontrer sur IP, abstraction `Transport` pour BLE / Wi-Fi Direct.
Rejeté : démarrer par BLE (débit insuffisant pour les charges IA) et
Wi-Fi Aware (matériel rare, **[RECHERCHE]**).
Révocation : si 3+ appareils BLE appairés et stables pendant 1 h de test.

## D2. Validation par quorum, pas de blockchain

Contexte : résultats vérifiables sans infrastructure lourde.
Décision : quorum 2/3 + hachages comparés + signatures Ed25519.
Rejeté : blockchain (latence, coût, complexité) et simple ré-exécution
locale (ne détecte pas les nœuds fautifs).
Révocation : si le taux de désaccord dépasse 5 % sur charges réelles.

## D3. Muse conseiller, arbitre déterministe décideur

Contexte : LLMs non déterministes, coût et latence d'appel.
Décision : Muse propose une affectation expliquée ; l'arbitre applique
budgets, signatures et bornes, et peut refuser la proposition.
Rejeté : Muse décideur unique (non auditable) et pas de Muse du tout
(perd la différenciation du track).
Révocation : si O5 (≥ 15 % de gain) est réfutée, Muse passe en explicabilité
seule et le round-robin pondéré devient le plan A.

## D4. Identité Ed25519 + mTLS, sans PKI centrale

Contexte : pas d'autorité centrale dans un maillage.
Décision : clés auto-générées, empreinte = identité, confiance TOUF
+ option « nœuds de confiance ».
Rejeté : PKI centrale (point de défaillance) et absence de chiffrement.

## D5. Tâches idempotentes et sandboxées par défaut

Contexte : churn et ré-exécutions fréquentes.
Décision : toute tâche est rejouable sans effet de bord ; sandbox avec
quotas CPU/RAM/temps et sans réseau sortant.
Rejeté : exécution native illimitée (risque sécurité évident).

## D6. Monorepo modulaire, un module = un dossier testable

Contexte : travail parallèle de plusieurs flux.
Décision : modules à API documentée, dépendances unidirectionnelles,
tests par module avant tests d'intégration.
Rejeté : micro-dépôts séparés (friction d'intégration pendant le hackathon).

## D7. Mesures : journaux bruts obligatoires, zéro chiffre inventé

Contexte : crédibilité du track Push the Frontier.
Décision : chaque chiffre publié pointe vers protocole + matériel +
journal brut (voir [TEST_STRATEGY](TEST_STRATEGY.md)).
Aucune révocation possible : c'est une règle du projet (voir `AGENTS.md`).

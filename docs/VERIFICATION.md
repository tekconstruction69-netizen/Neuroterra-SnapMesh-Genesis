# Vérification, signatures et preuve (§7) — distinctions obligatoires

> Ces trois mots ne sont PAS interchangeables. Ce document fixe leur sens
> dans Genesis et ce que chaque mécanisme prouve réellement.

## 1. Trois garanties différentes

| Mécanisme | Ce qu'il prouve | Ce qu'il NE prouve PAS |
|---|---|---|
| **Reçu signé** (`receipt` + Ed25519) | QUI a produit QUOI à partir de QUOI : l'exécutant `E` a consommé l'entrée d'empreinte `inHash` et rendu la sortie d'empreinte `outHash` (imputabilité, non-répudiation) | Que le calcul est correct (un menteur signe des valeurs fausses : prouvé e2e, job `failed` malgré reçus valides) |
| **Empreintes E/S** (sha256) | Que la charge reçue = la charge envoyée et que le résultat voté = le résultat produit (intégrité, détection d'altération en transit) | L'origine (sans signature, cualquiera peut recalculer une empreinte) |
| **Quorum / re-calcul** (`decide`, r=1) | Que des exécutants indépendants convergent (faute isolée écartée) ; en r=1, que le coordinateur reproduit le résultat | Rien contre des menteurs collusifs majoritaires (assumé, documenté) |

## 2. Chaîne de vérification d'un fragment (ordre réel du code)

1. Enveloppe signée NT-ID (expéditeur authentifié, anti-rejeu) — `mesh-net`.
2. Canal chiffré si prêt (confidentialité) — §3.
3. Exécution en worker borné (liste blanche, bornes) — §4.
4. Reçu signé + empreintes joints au RESULT — §7 (`_handleTask`).
5. Coordinateur : signature, liaison `(from, taskId, op, inHash, outHash)`,
   conformité aux args de la tâche — rejet `bad-receipt`/`missing-receipt`
   **avant tout vote** (`_checkReceipt`).
6. Admission stricte sollicitée (`recordResult`) puis verdict :
   re-calcul local (r=1) ou quorum 2/3 (`mesh-verify`).
7. Faisceau du job : `verification {finalHash, fragments[{inHash, outHash,
   executedBy, receipts[{executor, sig, verified}]}]}` — re-vérifiable
   hors-ligne pour les empreintes ; les signatures exigent les clés
   publiques du registre.

## 3. Réponse finale à l'utilisateur

`submitDag()` rend `{outcome:'done', value, fragments, verification}` :
la valeur fusionnée selon le DAG + son faisceau. `finalHash` couvre la
valeur fusionnée ; chaque fragment couvre ses entrées/sorties et ses
exécutants. Échec : aucun faisceau (`verification` absente), le motif
l'indique (`tâche failed`, `proof-mismatch`, `fragment-expired`…).

## 4. Limites

- Même version de nœuds exigée pour comparer des empreintes (ordre des
  clés = ordre d'insertion).
- Quorum ≠ preuve cryptographique d'exactitude, ≠ anti-collusion.
- Menteur : résultat écarté + pair signalé (`fraudSuspects`), exclusion
  réseau [PRÉVU].

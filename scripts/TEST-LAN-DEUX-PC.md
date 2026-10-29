# Test inter-machines M1 — deux PC physiques sur le même LAN

> ⚠️ Test **non exécuté** par l'agent : requiert deux PC, un réseau local
> commun et le **consentement explicite** des deux opérateurs.
> Cocher chaque case avant de commencer.

## Consentement et prérequis

- [ ] Les deux opérateurs ont lu cette procédure et acceptent le test.
- [ ] Les deux PC sont sur le même LAN privé (pas de Wi-Fi public/invité).
- [ ] Node.js ≥ 18 installé depuis https://nodejs.org sur les deux PC.
- [ ] Le dossier `mesh-net/` est copié à l'identique sur les deux PC.
- [ ] Aucune modification du pare-feu sans l'accord explicite de l'opérateur
      du PC concerné (si Windows demande l'autorisation réseau : accepter
      uniquement « réseaux privés », jamais « publics »).

## PC-A (ex. IP 192.168.1.10)

```powershell
cd <chemin>\mesh-net
node bin\snapmesh-node.js --name pc-a --port 48001 --bind-host 0.0.0.0
```

Noter l'id affiché (`id=<12 caractères>`) et vérifier :
`http://127.0.0.1:48101/status` répond `{"self":…,"peers":[]}`.

## PC-B (ex. IP 192.168.1.11)

```powershell
cd <chemin>\mesh-net
node bin\snapmesh-node.js --name pc-b --port 48001 --bind-host 0.0.0.0 --peers 192.168.1.10:48001
```

## Résultat attendu (critère O1 inter-machines)

En moins de 10 s, chaque PC affiche l'autre en `connected`, puis la
découverte automatique (sans `--peers`) doit aussi fonctionner après
redémarrage des deux nœuds sans `--peers`.

## À consigner (preuves)

1. Les deux blocs `peers` complets des `/status` (copier-coller JSON).
2. Les lignes `[peer]`, latences constatées, adresse IP réelle utilisée.
3. Tout refus du pare-feu, échec ou comportement inattendu.
4. Archiver le tout dans `bench-logs/lan-2pc-<date>.md`.

## Arrêt propre

`Ctrl+C` sur chaque nœud (envoie BYE). Vérifier que le survivant marque
le pair `dead` puis le fait disparaître de sa vue live.

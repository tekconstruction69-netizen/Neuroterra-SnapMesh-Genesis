# M4 — Réseau physique (2-PC : procédure prête, exécution NON faite ici)

> Ce sandbox interdit `listen` (EACCES prouvé) : aucun socket réel
> n'est exécutable dans ce poste de développement. Tout le code
> ci-dessous est testé en fil simulé (copies JSON + enveloppes
> `seal`/`verifyEnvelope` réelles) et PRÊT pour 2 processus / 2 PC.

## 1. Code prêt

- Découverte : UDP existante + `manualPeers` (mode manuel si
  découverte bloquée) — sans toucher au pare-feu (aucune règle
  ajoutée/modifiée dans cette mission).
- Sessions : défi NT-ID + SESSION-KEY X25519/AES-GCM (§3, M1 37/37) ;
  hybride PQ composable (P7, 7/7).
- Négociation : `nt-ucp/bin/negotiate-node.js` (2 processus, accord
  bilatéral, exit 0/2) — testé en fil simulé (5/5), TCP réel hors sandbox.
- Tâches typées : ops whitelistées + nouvelles `tmat/tadd/tmati/tcast`
  (≤16, bornées) ; pont NeuroCore→M2 testé distant-simule (2/2, écart
  rel. 3,6e-8).
- Reprise : timeout→réaffectation M2 (prouvé), replan NeuroCore (prouvé).

## 2. Procédure 2-PC (hors sandbox, inchangée, voir TEST-LAN-DEUX-PC.md)

1. Les deux PC sur le même LAN, consentement explicite.
2. PC-A : `node mesh-compute/bin/compute-node.js --name A --port 48001
   --ephemeral --no-discovery` (notez l'id affiché).
3. PC-B : même commande `--port 48001 --peers <IP-A>:48001`.
4. Vérifier sessions vérifiées (`/status`), soumettre `--submit fib`.
5. Négociation : les deux `negotiate-node.js` (ports 48511/48512).
6. NE PAS modifier le pare-feu sans autorisation explicite : si le
   LAN bloque, utiliser le mode manuel (pairs IP:port) ou marquer
   NON EXÉCUTÉ avec le motif (port bloqué, pas de contournement).

## 3. Mesures réseau réelles (RTT/débit) : NON MESURÉES

Le transport compte les octets (NT-Flux) mais ne mesure pas encore
RTT/bande passante en continu ([PRÉVU] : sonde heartbeat chronométrée,
sans changer le protocole). Les coûts utilisent le débit documenté
(25 Mio/s loopback) — hypothèse, pas mesure.

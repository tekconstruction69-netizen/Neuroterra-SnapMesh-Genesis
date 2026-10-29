#!/usr/bin/env node
'use strict';

/**
 * CLI M1 : démarre un nœud SnapMesh.
 * Exemples :
 *   node bin/snapmesh-node.js --name a --port 48001
 *   node bin/snapmesh-node.js --name b --port 48002 --peers 127.0.0.1:48001
 *   node bin/snapmesh-node.js --name c --port 48003 --no-discovery --peers 127.0.0.1:48001
 */

const { SnapMeshNode } = require('../src/node');

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const name = arg('name', `node-${process.pid}`);
  const tcpPort = Number(arg('port', '48001'));
  const peers = (arg('peers', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const node = new SnapMeshNode({
    name,
    tcpPort,
    bindHost: arg('bind-host', '127.0.0.1'),
    keyFile: arg('key', `./data-${name}.key`),
    ephemeral: flag('ephemeral'),
    manualPeers: peers,
    discovery: !flag('no-discovery'),
    discoveryPort: arg('discovery-port', undefined) ? Number(arg('discovery-port')) : undefined,
    statusPort: Number(arg('status-port', String(tcpPort + 100))),
  });

  node.on('peer', (p) => console.log(`[peer] ${p.name} ${p.id.slice(0, 12)} connecté`));
  node.on('suspect', (p) => console.log(`[suspect] ${p.name} sans nouvelles`));
  node.on('dead', (p) => console.log(`[dead] ${p.name} déclaré mort`));
  node.on('bye', (p) => console.log(`[bye] ${p.id.slice(0, 12)} parti proprement`));
  node.on('rejected', (r) => console.log(`[rejeté] ${r.reason} de ${String(r.from).slice(0, 12)}`));
  node.on('session', (s) => console.log(`[session] ${String(s.id).slice(0, 12)} vérifiée=${s.verified ? 1 : 0}`));
  node.on('session-key', (s) => console.log(`[canal] chiffré prêt avec ${String(s.id).slice(0, 12)}`));
  node.on('error', (e) => console.error(`[erreur] ${e.message}`));

  await node.start();
  console.log(`Nœud "${name}" id=${node.id.slice(0, 12)} tcp=${tcpPort} http=127.0.0.1:${node.statusPort}/status`);

  if (arg('revoke', null) !== null) {
    // Auto-révocation (compromission) : prévient les pairs puis quitte.
    await new Promise((r) => setTimeout(r, 1500));
    await node.revokeSelf(arg('revoke', 'compromission'));
    console.log('[revoke] révocation émise');
    await node.stop();
    process.exit(0);
  }

  const quiet = flag('quiet');
  if (!quiet) {
    setInterval(() => {
      const s = node.snapshot();
      console.log(`--- ${s.self.name} : ${s.peers.length} pair(s) vivant(s) ---`);
      for (const p of s.peers) {
        console.log(`  ${p.short} ${p.name} [${p.state}] vu il y a ${p.lastSeenAgoMs} ms @ ${p.address}`);
      }
    }, Number(arg('status-interval', '5000')));
  }

  const shutdown = async () => {
    console.log('Arrêt…');
    await node.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('Démarrage impossible :', e.message);
  process.exit(1);
});

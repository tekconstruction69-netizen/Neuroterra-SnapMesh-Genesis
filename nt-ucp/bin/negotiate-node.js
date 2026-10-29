#!/usr/bin/env node
'use strict';

/**
 * P4 — nœud de négociation NT-UCP sur TCP réel (hors sandbox).
 * Usage (2 PowerShell ordinaires) :
 *   node nt-ucp/bin/negotiate-node.js --name A --port 48511 --status-port 49011 --no-discovery --ephemeral
 *   node nt-ucp/bin/negotiate-node.js --name B --port 48512 --status-port 49012 --peers 127.0.0.1:48511 --no-discovery --ephemeral
 * Le second démarre la négociation dès la session vérifiée ; les deux
 * affichent [accord] <JSON> puis se terminent (exit 0). Timeout 30 s.
 */

const { SnapMeshNode } = require('../../mesh-net/src/node');
const { Identity } = require('../../mesh-net/src/identity');
const { buildCaps } = require('../../mesh-net/src/caps');
const { detectBackends } = require('../../nt-compat/src/backends');
const { issueCert } = require('../src/cert');
const { Negotiator } = require('../src/session');

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const name = arg('name', `neg-${process.pid}`);
  const node = new SnapMeshNode({
    name,
    tcpPort: Number(arg('port', '48511')),
    bindHost: arg('bind-host', '127.0.0.1'),
    keyFile: arg('key', `./data-${name}.key`),
    ephemeral: flag('ephemeral'),
    manualPeers: (arg('peers', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
    discovery: !flag('no-discovery'),
    statusPort: Number(arg('status-port', String(Number(arg('port', '48511')) + 500))),
  });
  await node.start();
  console.log(`nœud ${name} id=${node.id.slice(0, 12)}`);
  const compat = detectBackends({ benchN: 16 });
  const cert = issueCert(node.identity, { nodeId: node.id, name, caps: buildCaps(), compat });
  const peerPubs = new Map();
  const neg = new Negotiator({
    cert,
    key: node.identity,
    sendFn: (id, type, payload) => node.sendEncrypted(id, type, payload),
    peerPubs,
  });
  node.on('message', (m) => {
    if (['NEG_HELLO', 'NEG_SELECT', 'NEG_DONE', 'NEG_REJECT'].includes(m.type)) neg.handleMessage(m);
  });
  neg.on('negotiated', ({ peer, selected }) => {
    console.log(`[accord] avec ${String(peer).slice(0, 12)} : ${JSON.stringify(selected)}`);
    console.log(`[stats] ${JSON.stringify(neg.stats)}`);
    setTimeout(() => process.exit(0), 500);
  });
  neg.on('neg-failed', ({ peer, reason }) => {
    console.log(`[échec] avec ${String(peer).slice(0, 12)} : ${reason}`);
  });
  // Alimente les clés apprises (défi NT-ID) puis démarre quand vérifié.
  const started = new Set();
  const timer = setInterval(() => {
    for (const p of node.registry.live()) {
      const fiche = node.registry.peers.get(p.id);
      if (fiche && fiche.pubB64 && !peerPubs.has(p.id)) {
        peerPubs.set(p.id, Buffer.from(fiche.pubB64, 'base64'));
      }
      if (node.registry.isSessionVerified(p.id) && peerPubs.has(p.id) && !started.has(p.id) && !neg.done.has(p.id)) {
        // Un seul initiateur (plus petit id) pour éviter la collision.
        if (node.id < p.id) {
          started.add(p.id);
          neg.start(p.id);
          console.log(`[nego] démarrage vers ${p.id.slice(0, 12)}`);
        }
      }
    }
  }, 500);
  timer.unref();
  void Identity;
  setTimeout(() => {
    console.error('[timeout] aucun accord en 30 s');
    process.exit(2);
  }, 30000).unref();
}

main().catch((e) => {
  console.error('Démarrage impossible :', e.message);
  process.exit(1);
});

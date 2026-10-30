'use strict';

/**
 * SnapMesh Direct — couche de communication directe appareil-à-appareil
 * (SANS box, routeur ni serveur central), au-dessus de NeuroCore, NT-UCP
 * et des protections existantes (rien n'est réécrit).
 *
 * Principes :
 * - Le direct ne transporte que des ENVELOPPES SCELLÉES produites par
 *   `SnapMeshNode.sealFor()` : identité NT-ID vérifiée et chiffrement de
 *   session AVANT tout transfert utile. Un lien direct ne contourne
 *   jamais l'authentification.
 * - Trame DIRECT v1 : {v, id, from, to, ttl, visited[], sealed} sur tout
 *   flux d'octets (socket Wi-Fi Direct, BLE fragmenté, TCP de test).
 * - Multi-sauts : TTL décrémenté, boucle détectée via `visited`
 *   (rejet `direct-loop`), jamais de retransmission aveugle.
 * - Bascule : `chooseTransport()` préfère le direct quand le pair y est
 *   joignable, sinon le TCP/IP existant (LAN/Internet).
 *
 * Composants natifs requis (hors PWA) :
 * - Windows : pont natif vers `Windows.Devices.WiFiDirect` (WinRT) —
 *   Node.js ne peut pas appeler WinRT sans module natif. Interface du
 *   pont : `NativeDirectBridge` (voir ci-dessous), transport [PRÉVU].
 * - Android : `WifiP2pManager` dans une application native — [PRÉVU].
 * - iOS 26 : Wi-Fi Aware / API natives compatibles — [RECHERCHE], natif
 *   requis, jamais promis via Safari.
 * - BLE : découverte légère et micro-messages uniquement (MTU fragmenté),
 *   jamais un transport de tâches IA — canal honnête, pas universel.
 */

const crypto = require('node:crypto');

const DIRECT_V = 1;
const DEFAULT_TTL = 3;

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function makeFrame({ from, to, sealed, ttl = DEFAULT_TTL, visited = [] }) {
  if (typeof from !== 'string' || typeof to !== 'string' || typeof sealed !== 'string') {
    throw new Error('direct: from/to/sealed requis');
  }
  if (!Number.isInteger(ttl) || ttl < 1) throw new Error('direct: ttl ≥ 1 requis');
  return { v: DIRECT_V, id: newId(), from, to, ttl, visited: [...visited], sealed };
}

/**
 * Fait transiter une trame vers le prochain saut.
 * Retourne { action: 'deliver'|'forward', frame } ou lève :
 * - direct-loop si notre id est déjà dans visited (boucle détectée),
 * - direct-ttl si le TTL est épuisé.
 */
function transit(frame, selfId) {
  if (!frame || frame.v !== DIRECT_V) throw new Error('direct: trame invalide');
  if (frame.to === selfId) return { action: 'deliver', frame };
  if (frame.ttl <= 1) throw new Error('direct-ttl: TTL épuisé');
  if (frame.visited.includes(selfId)) throw new Error('direct-loop: boucle détectée');
  return { action: 'forward', frame: { ...frame, ttl: frame.ttl - 1, visited: [...frame.visited, selfId] } };
}

/** Bascule automatique : direct si le pair y est joignable, sinon TCP/IP. */
function chooseTransport(peer, { directUp = false } = {}) {
  if (!peer || typeof peer.id !== 'string') throw new Error('direct: pair requis');
  return directUp ? 'direct' : 'tcp-ip';
}

/**
 * Transport de test en mémoire (MÊME HÔTE, étiqueté) : prouve le chemin
 * de code réel (trames, TTL, boucles, remise) sans radio.
 */
class LoopbackDirect {
  constructor() {
    this.inboxes = new Map(); // id -> [frame]
  }
  attach(id) {
    if (!this.inboxes.has(id)) this.inboxes.set(id, []);
  }
  send(to, frame) {
    if (!this.inboxes.has(to)) throw new Error(`direct: destinataire inconnu ${to}`);
    this.inboxes.get(to).push(frame);
    return 'envoye';
  }
  drain(id) {
    const box = this.inboxes.get(id) || [];
    this.inboxes.set(id, []);
    return box;
  }
}

module.exports = { DIRECT_V, DEFAULT_TTL, makeFrame, transit, chooseTransport, LoopbackDirect };

'use strict';

/**
 * Découverte LAN : annonces UDP broadcast périodiques {app, id, name,
 * tcpPort} et écoute des annonces des autres nœuds. Appelle onPeer pour
 * chaque annonce (y compris ses propres échos, filtrés par l'appelant).
 * Ne remplace pas la configuration manuelle (--peers), qui reste le
 * repli si le broadcast est bloqué (sandbox, VPN, Wi-Fi invité…).
 */

const dgram = require('node:dgram');

const DISCOVERY_PORT = 47820;
const APP_TAG = 'snapmesh-genesis-m1';
// Broadcast : LAN réel. Multicast : secours quand plusieurs nœuds partagent
// le même hôte (le broadcast n'est pas toujours rebouclé en local).
const BROADCAST_ADDR = '255.255.255.255';
const MULTICAST_ADDR = '239.0.7.7';

class Discovery {
  constructor({ nodeId, name, tcpPort, discoveryPort = DISCOVERY_PORT, intervalMs = 2000, onPeer, onError }) {
    this.nodeId = nodeId;
    this.name = name;
    this.tcpPort = tcpPort;
    this.discoveryPort = discoveryPort;
    this.intervalMs = intervalMs;
    this.onPeer = onPeer;
    this.onError = onError || (() => {});
    this.socket = null;
    this.timer = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      // reuseAddr : plusieurs nœuds cohabitent sur le port de découverte
      // (même machine en test, plusieurs appareils sur le LAN).
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket = sock;
      sock.on('error', (err) => this.onError(err));
      sock.on('message', (msg, rinfo) => {
        let ann;
        try {
          ann = JSON.parse(msg.toString('utf8'));
        } catch {
          return; // trame étrangère : ignorée, pas d'erreur
        }
        if (!ann || ann.app !== APP_TAG) return;
        if (typeof ann.id !== 'string' || typeof ann.tcpPort !== 'number') return;
        this.onPeer({ id: ann.id, name: ann.name, address: rinfo.address, tcpPort: ann.tcpPort });
      });
      sock.bind(this.discoveryPort, () => {
        try {
          sock.setBroadcast(true);
        } catch (err) {
          this.onError(err);
        }
        try {
          sock.addMembership(MULTICAST_ADDR);
          this.multicast = true;
        } catch (err) {
          this.multicast = false; // secours indisponible : broadcast seul
        }
        this.timer = setInterval(() => this.announce(), this.intervalMs);
        this.timer.unref();
        this.announce();
        resolve();
      });
      sock.on('error', reject);
    });
  }

  announce() {
    if (!this.socket) return;
    const msg = Buffer.from(
      JSON.stringify({ app: APP_TAG, id: this.nodeId, name: this.name, tcpPort: this.tcpPort })
    );
    this.socket.send(msg, this.discoveryPort, BROADCAST_ADDR, (err) => {
      if (err) this.onError(err);
    });
    if (this.multicast) {
      this.socket.send(msg, this.discoveryPort, MULTICAST_ADDR, (err) => {
        if (err) this.onError(err);
      });
    }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      await new Promise((resolve) => s.close(resolve));
    }
  }
}

module.exports = { Discovery, DISCOVERY_PORT, APP_TAG, BROADCAST_ADDR, MULTICAST_ADDR };

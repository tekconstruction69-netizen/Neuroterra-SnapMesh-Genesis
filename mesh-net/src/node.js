'use strict';

/**
 * Nœud SnapMesh M1 : serveur TCP + connexions sortantes, HELLO signé,
 * heartbeats, détection suspect/dead, reconnexion, registre observable
 * et mini-serveur HTTP /status. Point d'extension M2/M3 : brancher
 * l'ordonnancement sur registry.live() et injecter des tâches via les
 * types de messages (voir EXTENSION dans docs/M1_RAPPORT.md).
 */

const net = require('node:net');
const http = require('node:http');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { Identity } = require('./identity');
const { seal, encode, verifyEnvelope, LineFramer } = require('./protocol');
const { Registry } = require('./registry');
const { Discovery } = require('./discovery');

/** Vrai si l'adresse appartient à une interface locale. */
function isLocalAddress(addr) {
  if (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1') return true;
  const clean = String(addr).replace('::ffff:', '');
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const ni of ifs || []) {
      if (ni.address === clean) return true;
    }
  }
  return false;
}

function localCaps(name, extra = {}) {
  const { buildCaps } = require('./caps');
  return { name, platform: os.platform(), nodeVersion: process.version, ...buildCaps(extra) };
}

class SnapMeshNode extends EventEmitter {
  constructor({
    name = 'node',
    tcpPort = 48001,
    bindHost = '127.0.0.1', // 0.0.0.0 pour le LAN réel (hors sandbox)
    keyFile = null,
    ephemeral = false,
    manualPeers = [], // ["host:port"]
    discovery = true,
    discoveryPort = undefined, // défaut du module discovery
    heartbeatMs = 1000,
    suspectAfterMs = 3000,
    deadAfterMs = 6000,
    reconnectMs = 2000,
    statusPort = null, // défaut : tcpPort + 100
  } = {}) {
    super();
    this.name = name;
    this.tcpPort = tcpPort;
    this.bindHost = bindHost;
    this.identity = ephemeral ? Identity.generate() : Identity.loadOrCreate(keyFile);
    this.manualPeers = manualPeers;
    this.useDiscovery = discovery;
    this.discoveryPort = discoveryPort;
    this.heartbeatMs = heartbeatMs;
    this.suspectAfterMs = suspectAfterMs;
    this.deadAfterMs = deadAfterMs;
    this.reconnectMs = reconnectMs;
    this.statusPort = statusPort || tcpPort + 100;
    this.capsExtra = {}; // limites utilisateur + batterie/thermique (rempli par l'app)
    this.registry = new Registry();
    this.knownPub = new Map(); // id -> Buffer SPKI DER
    this.challenges = new Map(); // id -> nonce défi sortant (session NT-ID)
    this.pendingResponses = new Map(); // id -> nonce à répondre au rattachement
    this.seenNonces = new Map(); // id -> nonces d'enveloppes déjà vues (anti-rejeu, capé)
    const { generateEphemeral, exportRaw } = require('./session');
    this.sessionEphem = generateEphemeral(); // X25519 éphémère du processus
    this.sessionEphemPubB64 = exportRaw(this.sessionEphem.publicKey).toString('base64');
    this.sessionKeys = new Map(); // id -> clé AES-256 (canal chiffré prêt)
    this.sockets = new Map(); // id -> { socket, direction, framer }
    this.pendingOut = new Map(); // "host:port" -> socket (avant HELLO)
    this.seq = 0;
    this.startedAt = null;
    this.server = null;
    this.httpServer = null;
    this.hbTimer = null;
    this.sweepTimer = null;
    this.reconnectTimer = null;
    this.discoverySvc = null;
    this.wantDown = false;
  }

  get id() {
    return this.identity.id;
  }

  // ---------- cycle de vie ----------

  async start() {
    this.wantDown = false;
    this.startedAt = Date.now();
    await new Promise((resolve, reject) => {
      this.server = net.createServer((sock) => this._onInbound(sock));
      this.server.on('error', (err) => this.emit('error', err));
      this.server.listen(this.tcpPort, this.bindHost, resolve);
      this.server.on('error', reject);
    });
    await this._startStatus();
    if (this.useDiscovery) {
      this.discoverySvc = new Discovery({
        nodeId: this.id,
        name: this.name,
        tcpPort: this.tcpPort,
        discoveryPort: this.discoveryPort,
        onPeer: (p) => this._onDiscovered(p),
        onError: (err) => this.emit('error', err),
      });
      await this.discoverySvc.start();
    }
    for (const p of this.manualPeers) {
      const [host, port] = p.split(':');
      this._connectOut(host, Number(port), { manual: true });
    }
    this.hbTimer = setInterval(() => this._sendHeartbeats(), this.heartbeatMs);
    this.hbTimer.unref();
    this.sweepTimer = setInterval(() => this._sweep(), Math.max(250, this.suspectAfterMs / 6));
    this.sweepTimer.unref();
    this.reconnectTimer = setInterval(() => this._reconnect(), this.reconnectMs);
    this.reconnectTimer.unref();
    this.emit('started', { id: this.id, tcpPort: this.tcpPort });
  }

  async stop() {
    this.wantDown = true;
    for (const t of [this.hbTimer, this.sweepTimer, this.reconnectTimer]) {
      if (t) clearInterval(t);
    }
    if (this.discoverySvc) await this.discoverySvc.stop().catch(() => {});
    // BYE gracieux aux pairs vivants.
    for (const [id] of this.sockets) this._sendTo(id, 'BYE', {});
    await new Promise((r) => setTimeout(r, 150));
    for (const [, s] of this.sockets) s.socket.destroy();
    this.sockets.clear();
    for (const [, s] of this.pendingOut) s.destroy();
    this.pendingOut.clear();
    if (this.server) await new Promise((r) => this.server.close(r));
    if (this.httpServer) await new Promise((r) => this.httpServer.close(r));
    this.emit('stopped');
  }

  // ---------- TCP ----------

  _onInbound(socket) {
    const framer = new LineFramer(
      (env) => this._onMessage(null, socket, framer, env, 'in'),
      () => socket.destroy()
    );
    socket.on('data', (c) => framer.push(c));
    socket.on('error', () => {});
    socket.on('close', () => this._onSocketClose(socket));
    socket._mesh = { peerId: null, direction: 'in', framer };
    // Le HELLO part aussi sur l'entrante : les deux côtés s'identifient.
    this._sendHello(socket);
  }

  _connectOut(host, port, { manual = false } = {}) {
    const key = `${host}:${port}`;
    if (this.pendingOut.has(key)) return;
    const socket = net.connect(port, host);
    this.pendingOut.set(key, socket);
    socket._mesh = { peerId: null, direction: 'out', manual, key };
    const framer = new LineFramer(
      (env) => this._onMessage(key, socket, framer, env, 'out'),
      () => socket.destroy()
    );
    socket._mesh.framer = framer;
    socket.on('connect', () => this._sendHello(socket));
    socket.on('data', (c) => framer.push(c));
    socket.on('error', () => {});
    socket.on('close', () => {
      this.pendingOut.delete(key);
      this._onSocketClose(socket);
    });
  }

  _sendHello(socket) {
    const { signCaps } = require('./caps');
    const caps = signCaps(this.identity, this.caps());
    socket.write(encode(seal(this.identity, 'HELLO', { name: this.name, caps, tcpPort: this.tcpPort })));
  }

  _sendTo(id, type, payload) {
    const s = this.sockets.get(id);
    if (!s) return false;
    if (type === 'HEARTBEAT') payload = { ...payload, seq: this.seq++ };
    s.socket.write(encode(seal(this.identity, type, payload)));
    return true;
  }

  _onMessage(pendingKey, socket, framer, env, direction) {
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      this.emit('rejected', { reason: 'bad-frame', from: null });
      socket.destroy();
      return;
    }
    const known = this.knownPub.get(env.from) || null;
    const res = verifyEnvelope(env, known);
    if (!res.ok) {
      this.emit('rejected', { reason: res.reason, from: env.from });
      if (res.reason === 'bad-signature' || res.reason === 'unknown-sender') socket.destroy();
      return;
    }
    if (env.from === this.id) return; // écho de soi-même (découverte)
    const peerId = env.from;

    // Anti-rejeu NT-ID : nonce signé déjà vu -> ignoré sans effet.
    let seen = this.seenNonces.get(peerId);
    if (!seen) {
      seen = [];
      this.seenNonces.set(peerId, seen);
    }
    if (seen.includes(env.n)) {
      this.emit('rejected', { reason: 'replay', from: peerId });
      return;
    }
    seen.push(env.n);
    if (seen.length > 500) seen.splice(0, seen.length - 500);

    // Rentrée relais : types applicatifs déjà filtrés (TASK/RESULT), signature
    // de l'expéditeur vérifiée ; remis aux couches supérieures sans toucher
    // au lien du relayeur (ni rattachement, ni destruction).
    if (direction === 'relay') {
      if (env.type !== 'TASK' && env.type !== 'RESULT') {
        this.emit('rejected', { reason: 'relay-type', from: peerId });
        return;
      }
      this.emit('message', { type: env.type, from: peerId, payload: env.payload, ts: env.ts, relayed: true });
      return;
    }

    if (env.type === 'HELLO') {
      if (this.registry.isRevoked(peerId)) {
        this.emit('rejected', { reason: 'revoked', from: peerId });
        socket.destroy();
        return;
      }
      this.knownPub.set(peerId, res.pub);
      const addr = `${socket.remoteAddress}:${socket.remotePort}`;
      // NT-CAP : profil vérifié par sa signature propre, sinon ignoré.
      const { verifyCaps } = require('./caps');
      const rawCaps = env.payload?.caps;
      const capsOk = verifyCaps(rawCaps, res.pub.toString('base64'));
      if (!capsOk) this.emit('rejected', { reason: 'bad-caps', from: peerId });
      this.registry.upsert({
        id: peerId,
        name: env.payload?.name,
        caps: capsOk ? rawCaps : {},
        address: addr,
        pubB64: res.pub.toString('base64'),
      });
      this.registry.touch(peerId);
      this._attachSocket(peerId, socket, pendingKey, direction);
      this.emit('peer', { id: peerId, name: env.payload?.name });
      // Échange de pairs connus : aide les nouveaux à rejoindre vite.
      this._sendTo(peerId, 'PEERS', {
        peers: this.registry.live().map((p) => ({ id: p.id, address: p.address })),
      });
      return;
    }

    // Types session/identité : traités sur signature seule (avant rattachement),
    // pour que le défi aboutisse même si les deux HELLO se croisent.
    const entry = this.sockets.get(peerId);
    // SESSION-KEY/ENCRYPTED/RELAY : pas d'entrée requise (échange précoce,
    // relais vers pairs inconnus par construction ; la clé de session est
    // le vrai garde pour ENCRYPTED, la signature pour les autres).
    if (!entry && !['CHALLENGE', 'RESPONSE', 'REVOCATION', 'RENEW', 'SESSION-KEY', 'ENCRYPTED', 'RELAY'].includes(env.type)) {
      socket.destroy();
      return;
    }
    // --- Session NT-ID : défi/réponse de possession fraîche de la clé ---
    if (env.type === 'CHALLENGE') {
      if (typeof env.payload?.nonce !== 'string') return;
      if (entry) this._sendTo(peerId, 'RESPONSE', { nonce: env.payload.nonce });
      else this.pendingResponses.set(peerId, env.payload.nonce); // répondu au rattachement
      return;
    }
    if (env.type === 'RESPONSE') {
      const want = this.challenges.get(peerId);
      if (want && env.payload?.nonce === want) {
        this.challenges.delete(peerId);
        this.registry.setSessionVerified(peerId, true);
        this.emit('session', { id: peerId, verified: true });
      }
      return;
    }
    // --- Révocation : auto-révocation signée (compromission), effet immédiat ---
    if (env.type === 'REVOCATION') {
      if (env.payload?.revokedId === peerId) {
        this.registry.revoke(peerId, String(env.payload?.reason || 'compromission'));
        const s = this.sockets.get(peerId);
        if (s) s.socket.destroy();
        this.sockets.delete(peerId);
        this.sessionKeys.delete(peerId); // canal chiffré révoqué avec l'identité
        this.emit('revoked', { id: peerId });
      }
      return;
    }
    // --- Renouvellement : nouvelle clé avalisée par l'ancienne ---
    if (env.type === 'RENEW') {
      this._handleRenew(peerId, env.payload);
      return;
    }
    // Canal chiffré / relais : routés avant l'exigence d'entrée.
    if (env.type === 'SESSION-KEY') {
      this._handleSessionKey(peerId, env.payload);
      return;
    }
    if (env.type === 'ENCRYPTED') {
      this._handleEncrypted(peerId, env.payload);
      return;
    }
    if (env.type === 'RELAY') {
      if (direction === 'relay') {
        // Relais imbriqué : refusé (un seul saut logique par RELAY).
        this.emit('rejected', { reason: 'relay-nested', from: peerId });
        return;
      }
      // Le relais ne transporte que des types applicatifs.
      let innerType = null;
      try {
        innerType = JSON.parse(env.payload?.sealed || '').type;
      } catch {
        this.emit('rejected', { reason: 'relay-sealed', from: peerId });
        return;
      }
      if (!['TASK', 'RESULT'].includes(innerType)) {
        this.emit('rejected', { reason: 'relay-type', from: peerId });
        return;
      }
      if (env.payload?.to === this.id && !entry) {
        // Destinataire non rattaché à l'expéditeur : rattachement relais.
        this._handleRelay(peerId, env.payload, socket);
        return;
      }
      if (!entry) {
        socket.destroy();
        return;
      }
      this._handleRelay(peerId, env.payload, socket);
      return;
    }
    if (!entry) {
      socket.destroy();
      return;
    }
    if (env.type === 'HEARTBEAT') {
      const r = this.registry.touch(peerId, env.payload?.seq);
      if (r === 'stale-seq') return; // rejou ancien : ignoré
      // NT-CAP live : RTT estimé (horloges non synchronisées) + RAM fraîche.
      const tSend = env.payload?.tSend;
      if (typeof tSend === 'number' && tSend > 0 && tSend <= Date.now()) {
        this.registry.setRtt(peerId, Date.now() - tSend);
      }
      if (typeof env.payload?.freeMem === 'number') {
        this.registry.setRamFree(peerId, env.payload.freeMem);
      }
      return;
    }
    if (env.type === 'PEERS') {
      // Durcissement audit M1 : n'accepter que des entrées valides ; un pair
      // malveillant ne peut provoquer qu'une connexion sortante vers un
      // hôte:port syntaxiquement valide (risque résiduel documenté).
      const list = Array.isArray(env.payload?.peers) ? env.payload.peers.slice(0, 32) : [];
      for (const p of list) {
        if (!p || p.id === this.id || this.sockets.has(p.id)) continue;
        if (typeof p.id !== 'string' || typeof p.address !== 'string') continue;
        const i = p.address.lastIndexOf(':');
        const host = i > 0 ? p.address.slice(0, i).replace('::ffff:', '') : null;
        const port = i > 0 ? Number(p.address.slice(i + 1)) : NaN;
        if (!host || !Number.isInteger(port) || port < 1 || port > 65535) continue;
        this._connectOut(host, port);
      }
      return;
    }
    // Point d'extension M2 : tout autre type vérifié est remis aux couches
    // supérieures (TASK/RESULT) au lieu d'être ignoré.
    this.emit('message', { type: env.type, from: peerId, payload: env.payload, ts: env.ts });
    if (env.type === 'BYE') {
      this.registry.setState(peerId, 'dead');
      this.emit('bye', { id: peerId });
      socket.destroy();
      return;
    }
  }

  /** Renouvellement : nouvelle clé avalisée par signature de l'ancienne. */
  _handleRenew(peerId, payload) {
    void peerId;
    const { oldId, newPubB64, sigByOld } = payload || {};
    if (typeof oldId !== 'string' || typeof newPubB64 !== 'string' || typeof sigByOld !== 'string') return;
    const { fingerprintOfPublicKey, Identity } = require('./identity');
    let newPub;
    try {
      newPub = Buffer.from(newPubB64, 'base64');
    } catch {
      return;
    }
    const newId = fingerprintOfPublicKey(newPub);
    const oldPub = this.knownPub.get(oldId);
    if (!oldPub) return; // on ne relaye que ce qu'on connaît
    let ok = false;
    try {
      ok = Identity.verifyWith(oldPub, Buffer.from(newId, 'utf8'), Buffer.from(sigByOld, 'base64'));
    } catch {
      return;
    }
    if (ok) {
      this.registry.setSuccessor(oldId, newId);
      this.emit('renewed', { oldId, newId });
    }
  }

  /**
   * Règle anti-doublon déterministe : les deux côtés voient les mêmes ids,
   * un seul socket survit — celui initié par le plus grand id.
   */
  _attachSocket(peerId, socket, pendingKey, direction) {
    if (pendingKey) this.pendingOut.delete(pendingKey);
    const existing = this.sockets.get(peerId);
    if (existing && existing.socket !== socket) {
      const keepOutbound = peerId > this.id; // initiée par le plus grand id
      const wantThis = (direction === 'out') === keepOutbound;
      if (!wantThis) {
        socket.destroy();
        return;
      }
      existing.socket.destroy();
    }
    socket._mesh.peerId = peerId;
    this.sockets.set(peerId, { socket, direction, framer: socket._mesh.framer });
    // Session NT-ID : défi frais à chaque (re)rattachement non vérifié.
    if (!this.registry.isSessionVerified(peerId)) {
      const crypto = require('node:crypto');
      this.challenges.set(peerId, crypto.randomBytes(16).toString('hex'));
      this._sendTo(peerId, 'CHALLENGE', { nonce: this.challenges.get(peerId) });
    }
    const pending = this.pendingResponses.get(peerId);
    if (pending) {
      this.pendingResponses.delete(peerId);
      this._sendTo(peerId, 'RESPONSE', { nonce: pending });
    }
    // Canal chiffré : publie la clé éphémère (l'autre sens arrive pareil).
    this._sendTo(peerId, 'SESSION-KEY', { epub: this.sessionEphemPubB64 });
  }

  /** Envoie chiffré si le canal est prêt, sinon clair signalé. */
  sendEncrypted(id, type, payload) {
    const key = this.sessionKeys.get(id);
    if (!key) {
      this._sendTo(id, type, { ...payload, enc: false });
      return 'plain';
    }
    const { sealPayload } = require('./session');
    this._sendTo(id, 'ENCRYPTED', { inner: sealPayload(key, { type, payload }), enc: true });
    return 'encrypted';
  }

  /** Relais minimal : confie une enveloppe scellée à un voisin direct. */
  sendRelayVia(relayId, to, sealedEnvelope, originPubB64, ttl = 3) {
    return this._sendTo(relayId, 'RELAY', { to, ttl, sealed: sealedEnvelope, originPub: originPubB64 });
  }

  /** Scelle une enveloppe sans l'envoyer (origine d'un relais). */
  sealFor(type, payload) {
    return encode(seal(this.identity, type, payload)).toString('utf8');
  }

  /** Clé publique Ed25519 locale (base64), pour accompagner un relais. */
  get pubB64() {
    return this.identity.publicKeyB64 || null;
  }

  _handleSessionKey(peerId, payload) {
    if (typeof payload?.epub !== 'string') return;
    try {
      const { importRawPeer, deriveShared } = require('./session');
      const peerPub = importRawPeer(Buffer.from(payload.epub, 'base64'));
      const key = deriveShared(this.sessionEphem.privateKey, peerPub);
      this.sessionKeys.set(peerId, key);
      this.emit('session-key', { id: peerId });
    } catch {
      this.emit('rejected', { reason: 'bad-session-key', from: peerId });
    }
  }

  _handleEncrypted(peerId, payload) {
    const key = this.sessionKeys.get(peerId);
    if (!key || !payload?.inner) {
      this.emit('rejected', { reason: 'no-session-key', from: peerId });
      return;
    }
    const { openPayload } = require('./session');
    let inner;
    try {
      inner = openPayload(key, payload.inner);
    } catch {
      this.emit('rejected', { reason: 'bad-ciphertext', from: peerId });
      return;
    }
    if (!inner || typeof inner.type !== 'string') return;
    // Contenu authentifié (canal) + expéditeur authentifié (enveloppe signée).
    this.emit('message', { type: inner.type, from: peerId, payload: inner.payload, ts: Date.now(), encrypted: true });
  }

  _handleRelay(peerId, payload, socket) {
    const { to, ttl, sealed, originPub } = payload || {};
    if (typeof to !== 'string' || typeof sealed !== 'string' || typeof originPub !== 'string') return;
    if (typeof ttl !== 'number' || ttl <= 0) {
      this.emit('rejected', { reason: 'relay-ttl', from: peerId });
      return;
    }
    if (to === this.id) {
      // Destinataire : apprend la clé d'origine (comme HELLO) puis traite.
      const { fingerprintOfPublicKey } = require('./identity');
      let pub;
      try {
        pub = Buffer.from(originPub, 'base64');
      } catch {
        return;
      }
      let env;
      try {
        env = JSON.parse(sealed);
      } catch {
        return;
      }
      if (!this.knownPub.has(env.from)) {
        if (fingerprintOfPublicKey(pub) !== env.from) {
          this.emit('rejected', { reason: 'relay-id-pub-mismatch', from: peerId });
          return;
        }
        this.knownPub.set(env.from, pub);
      }
      this._onMessage(null, socket, null, env, 'relay');
      return;
    }
    // Transit : retransmet au voisin direct, TTL décrémenté.
    if (!this.sockets.has(to)) {
      this.emit('rejected', { reason: 'relay-no-route', from: peerId });
      return;
    }
    this._sendTo(to, 'RELAY', { to, ttl: ttl - 1, sealed, originPub });
  }

  /** Émet sa révocation (compromission) puis s'arrête : dernier message signé. */
  async revokeSelf(reason = 'compromission') {
    for (const [id] of this.sockets) {
      this._sendTo(id, 'REVOCATION', { revokedId: this.id, reason });
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  _onSocketClose(socket) {
    const peerId = socket._mesh?.peerId;
    if (!peerId) return;
    const entry = this.sockets.get(peerId);
    if (entry && entry.socket === socket) this.sockets.delete(peerId);
    this.sessionKeys.delete(peerId); // renégocié à la prochaine session
    // La détection suspect/dead passe par le sweeper (pas de faux positif
    // sur un simple renouvellement de connexion).
  }

  // ---------- heartbeats, balayage, reconnexion ----------

  _sendHeartbeats() {
    for (const [id] of this.sockets) {
      this._sendTo(id, 'HEARTBEAT', { tSend: Date.now(), freeMem: os.freemem() });
    }
  }

  _sweep() {
    const now = Date.now();
    for (const p of this.registry.live()) {
      const ago = now - p.lastSeen;
      if (ago >= this.deadAfterMs && p.state !== 'dead') {
        this.registry.setState(p.id, 'dead');
        const s = this.sockets.get(p.id);
        if (s) s.socket.destroy();
        this.sockets.delete(p.id);
        this.sessionKeys.delete(p.id);
        this.emit('dead', { id: p.id, name: p.name });
      } else if (ago >= this.suspectAfterMs && p.state === 'connected') {
        this.registry.setState(p.id, 'suspect');
        this.emit('suspect', { id: p.id, name: p.name });
      }
    }
  }

  _reconnect() {
    if (this.wantDown) return;
    // Pairs manuels : toujours réessayer s'ils ne sont pas connectés.
    for (const p of this.manualPeers) {
      const [host, port] = p.split(':');
      const stillThere = [...this.sockets.keys()].some((id) => {
        const r = this.registry.get(id);
        return r && r.address && r.address.endsWith(`:${port}`);
      });
      if (!stillThere) this._connectOut(host, Number(port), { manual: true });
    }
  }

  _onDiscovered({ id, name, address, tcpPort }) {
    if (id === this.id || this.sockets.has(id)) return;
    // Même hôte, plusieurs instances : l'annonce arrive avec l'IP LAN
    // alors que le TCP n'écoute qu'en loopback -> reboucler en local.
    const host = isLocalAddress(address) ? '127.0.0.1' : address;
    this._connectOut(host, tcpPort);
    this.emit('discovered', { id, name, address: host });
  }

  // ---------- observabilité ----------

  snapshot() {
    return {
      self: { id: this.id, short: this.id.slice(0, 12), name: this.name, tcpPort: this.tcpPort, encryptedPeers: this.sessionKeys.size },
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      peers: this.registry.live(),
    };
  }

  _startStatus() {
    return new Promise((resolve) => {
      this.httpServer = http.createServer((req, res) => {
        if (req.url === '/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(this.snapshot()));
        } else {
          res.writeHead(404);
          res.end('not found');
        }
      });
      this.httpServer.listen(this.statusPort, '127.0.0.1', resolve);
    });
  }

  caps() {
    return localCaps(this.name, this.capsExtra);
  }
}

module.exports = { SnapMeshNode, localCaps };

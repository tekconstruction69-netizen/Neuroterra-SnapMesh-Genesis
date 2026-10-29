'use strict';

/**
 * NT Global Registry — prototype local de registre des nœuds (M7).
 * Bibliothèque locale non authentifiée, non reliée à la passerelle
 * Netlify : aucune authentification n'est implémentée ici.
 * Enregistre : NT-ID et capsHash avec validation de format seulement
 * (capsHash = empreinte déclarée au format sha256 hexadécimal ;
 * capacités déclarées — aucune signature, aucune preuve de propriété
 * de clé et aucun manifeste vérifié), région, groupe d'entreprise,
 * politique de contribution, dernier heartbeat.
 * Expiration automatique : un nœud sans heartbeat > ttlMs sort des vues
 * vivantes. Rejet d'adresse limité : seuls les champs d'adresse directs
 * ip/ipAddress/address/host/privateIp (insensible à la casse) sont
 * rejetés ; region et groupId sont des chaînes libres non filtrées —
 * aucune promesse d'absence universelle d'IP (une IP en texte libre
 * dans region/groupId ne serait pas rejetée). Persistance : fichier
 * JSON local à écriture atomique (tmp + rename). Aucun adaptateur
 * Supabase implémenté : backendFromEnv détecte seulement la présence
 * d'une configuration, sans aucun appel réseau quel que soit le
 * résultat (sync [PRÉVU] ; les secrets ne sont jamais journalisés).
 */

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_V = 1;
const DEFAULT_TTL_MS = 30000;

function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }

function validateEntry(e) {
  if (!isObj(e)) throw new Error('registre: entrée objet requise');
  for (const k of Object.keys(e)) {
    if (/^(ip|ipAddress|address|host|privateIp)$/i.test(k)) {
      throw new Error(`registre: champ adresse interdit (${k}) — l'IP n'est jamais une identité`);
    }
  }
  if (typeof e.ntId !== 'string' || !/^[0-9a-f-]{16,128}$/i.test(e.ntId)) throw new Error('registre: ntId (empreinte) requis');
  if (typeof e.capsHash !== 'string' || !/^[0-9a-f]{64}$/i.test(e.capsHash)) throw new Error('registre: capsHash sha256 requis');
  if (typeof e.region !== 'string' || !e.region) throw new Error('registre: region requise');
  return {
    ntId: e.ntId, capsHash: e.capsHash.toLowerCase(), region: e.region,
    groupId: typeof e.groupId === 'string' ? e.groupId : 'public',
    policy: isObj(e.policy) ? {
      cpuCapPct: Number.isFinite(e.policy.cpuCapPct) ? e.policy.cpuCapPct : null,
      memCapBytes: Number.isFinite(e.policy.memCapBytes) ? e.policy.memCapBytes : null,
      acceptRemote: e.policy.acceptRemote === true,
    } : { cpuCapPct: null, memCapBytes: null, acceptRemote: false },
  };
}

class GlobalRegistry {
  constructor({ file = null, ttlMs = DEFAULT_TTL_MS } = {}) {
    this.file = file;
    this.ttlMs = ttlMs;
    this.nodes = new Map();
    if (file && fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j.v === REGISTRY_V && Array.isArray(j.nodes)) {
        for (const n of j.nodes) this.nodes.set(n.ntId, n);
      }
    }
  }

  _save() {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ v: REGISTRY_V, nodes: [...this.nodes.values()] }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  register(entry, now = Date.now()) {
    const e = validateEntry(entry);
    const rec = { ...e, firstSeen: (this.nodes.get(e.ntId) || {}).firstSeen || now, lastSeen: now };
    this.nodes.set(e.ntId, rec);
    this._save();
    return rec;
  }

  heartbeat(ntId, now = Date.now()) {
    const rec = this.nodes.get(ntId);
    if (!rec) throw new Error(`registre: ntId inconnu ${ntId}`);
    rec.lastSeen = now;
    this._save();
    return rec;
  }

  /** Nœuds vivants (heartbeat frais), filtrables par région/groupe. */
  listLive({ now = Date.now(), region = null, groupId = null } = {}) {
    return [...this.nodes.values()]
      .filter((n) => now - n.lastSeen <= this.ttlMs)
      .filter((n) => !region || n.region === region)
      .filter((n) => !groupId || n.groupId === groupId)
      .map((n) => ({ ntId: n.ntId, capsHash: n.capsHash, region: n.region, groupId: n.groupId, policy: n.policy, ageMs: now - n.lastSeen }));
  }

  /** Purge les expirés (retourne le nombre purgé). */
  sweep(now = Date.now()) {
    let purged = 0;
    for (const [id, n] of this.nodes) {
      if (now - n.lastSeen > this.ttlMs) { this.nodes.delete(id); purged++; }
    }
    if (purged) this._save();
    return purged;
  }
}

/** Détection de configuration seulement : aucun adaptateur Supabase, aucun appel réseau. */
function backendFromEnv(env = process.env) {
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    return { mode: 'supabase', configured: true, sync: 'PRÉVU (aucun appel sans revue du schéma SQL et des politiques RLS)' };
  }
  return { mode: 'fichier-local', configured: false, sync: null };
}

module.exports = { REGISTRY_V, DEFAULT_TTL_MS, GlobalRegistry, validateEntry, backendFromEnv };

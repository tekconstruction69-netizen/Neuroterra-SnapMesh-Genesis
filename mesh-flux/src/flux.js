'use strict';

/**
 * Façade NT-Flux : pack/unpack avec métriques réelles (tailles + temps +
 * CPU/mémoire observables via process.cpuUsage/memoryUsage — jamais
 * d'énergie inventée). Sans état inter-tâches (codecs purs).
 */

const { CODECS, announcedSize } = require('./codecs');
const { selectEncoding } = require('./policy');

const DEFAULTS = {
  effort: 'normal',
  maxDecompressedBytes: 4 * 1024 * 1024,
  maxCompressedBytes: 2 * 1024 * 1024,
  // Borne ABSOLUE = protection mémoire réelle (refus). Le ratio > maxRatio
  // est SIGNALÉ (metrics.suspicious), jamais bloquant seul : un contenu
  // légitime très redondant dépasse 1000× (brotli sur répétitions).
  maxRatio: 1000,
  requiresExact: true,
};

function cpuSample() {
  return process.cpuUsage();
}
function cpuMsSince(s) {
  const d = process.cpuUsage(s);
  return (d.user + d.system) / 1000;
}

/**
 * Emballe un Buffer : {encoding, codec?, data(b64), origBytes, metrics}.
 * Choix déterministe (policy) ; raw si aucun gain / codec indisponible.
 */
function pack(buf, opts = {}) {
  const o = { ...DEFAULTS, ...(opts || {}) };
  const cpu0 = cpuSample();
  const mem0 = process.memoryUsage().heapUsed;
  const decision = selectEncoding(buf, o);
  let data = buf;
  let tCodec = 0;
  if (decision.codec !== 'raw') {
    const c = CODECS[decision.codec];
    if (!c || !c.available) {
      const raw = { encoding: 'raw', codec: 'raw', data: buf.toString('base64'), origBytes: buf.length, metrics: null, decision: { codec: 'raw', reason: 'codec-indisponible' } };
      raw.metrics = { tPackMs: cpuMsSince(cpu0), memDeltaBytes: process.memoryUsage().heapUsed - mem0 };
      return raw;
    }
    const r = c.compress(buf);
    data = r.data;
    tCodec = r.timeMs;
  }
  const out = {
    encoding: decision.codec === 'raw' ? 'raw' : 'flux',
    codec: decision.codec,
    data: data.toString('base64'),
    origBytes: buf.length,
    decision: { codec: decision.codec, reason: decision.reason, ratio: decision.ratio },
    metrics: null,
  };
  out.metrics = {
    inBytes: buf.length,
    outBytes: data.length,
    tCodecMs: tCodec,
    tPackMs: cpuMsSince(cpu0),
    memDeltaBytes: process.memoryUsage().heapUsed - mem0,
  };
  return out;
}

/**
 * Déballe avec gardes : codec connu, entrée bornée, taille annoncée (gzip
 * ISIZE, pré-refus sans gonfler), sortie bornée, ratio suspect.
 */
function unpack(env, opts = {}) {
  const o = { ...DEFAULTS, ...(opts || {}) };
  if (!env || typeof env !== 'object') throw new Error('flux-invalide: enveloppe');
  if (env.encoding === 'raw' || env.codec === 'raw' || !env.codec) {
    const data = Buffer.from(env.data || '', 'base64');
    if (data.length > o.maxDecompressedBytes) throw new Error('flux-trop-gros: brut hors borne');
    return { data, codec: 'raw', metrics: { inBytes: data.length, outBytes: data.length, tCodecMs: 0 } };
  }
  const c = CODECS[env.codec];
  if (!c || !c.available) throw new Error(`flux-invalide: codec inconnu ${env.codec}`);
  const wire = Buffer.from(env.data || '', 'base64');
  if (wire.length > o.maxCompressedBytes) throw new Error('flux-trop-gros: entrée hors borne');
  const announced = announcedSize(env.codec, wire);
  if (announced !== null && announced > o.maxDecompressedBytes) {
    throw new Error('flux-bombe: taille annoncée hors borne (refusé sans gonfler)');
  }
  const { data, timeMs } = c.decompress(wire);
  if (data.length > o.maxDecompressedBytes) throw new Error('flux-trop-gros: sortie hors borne');
  // Ratio suspect = SIGNALÉ (métrique), jamais bloquant seul : un contenu
  // légitime très redondant dépasse 1000× (brotli). La borne absolue
  // ci-dessus est la protection mémoire réelle. Voir NT_FLUX_SECURITY.md.
  const ratio = data.length / Math.max(1, wire.length);
  return { data, codec: env.codec, metrics: { inBytes: wire.length, outBytes: data.length, tCodecMs: timeMs, ratio, suspicious: ratio > o.maxRatio } };
}

module.exports = { DEFAULTS, pack, unpack };

'use strict';

/**
 * Politique déterministe NT-Flux : minimise le coût total estimé.
 * Coût(codec) = tCompress(size) + size*ratio/débit + tDecompress(size)
 * avec temps extrapolés linéairement depuis l'échantillon.
 * Règles : exactitude requise ⇒ jamais de lossy (tous nos codecs sont
 * lossless ; le garde existe pour l'avenir) ; déjà-compressé ou ratio >
 * 0,95 ⇒ raw ; gain < 5 % ⇒ raw ; effort eco ⇒ raw sauf ratio < 0,5 ;
 * effort performance ⇒ meilleur ratio (temps CPU ignoré sauf budget) ;
 * temps estimé > maxCompressMs ⇒ raw. Toujours un codec disponible (raw).
 */

const { estimateRatios, detectMagic } = require('./estimate');

const EFFORTS = ['eco', 'normal', 'performance'];

function selectEncoding(buf, {
  effort = 'normal',
  requiresExact = true,
  net = {},
  maxCompressMs = 500,
  codecs = ['deflate', 'gzip', 'brotli'],
} = {}) {
  if (!EFFORTS.includes(effort)) effort = 'normal';
  const size = buf.length;
  if (size === 0) return { codec: 'raw', reason: 'vide', ratio: 1, costMs: 0 };
  const magic = detectMagic(buf);
  if (magic) return { codec: 'raw', reason: `déjà-compressé (${magic})`, ratio: 1, costMs: 0 };
  const bps = net.bytesPerSec && net.bytesPerSec > 0 ? net.bytesPerSec : 25 * 1024 * 1024; // défaut loopback mesuré §bench
  const rttMs = net.rttMs || 0;
  // Exactitude requise ⇒ codecs avec perte exclus (aucun aujourd'hui : garde d'avenir).
  const { CODECS } = require('./codecs');
  const allowed = codecs.filter((n) => CODECS[n] && (!requiresExact || CODECS[n].lossless !== false));
  const estimates = estimateRatios(buf, { codecs: allowed });
  const sampleLen = Math.min(buf.length, 65536);
  const scale = size / Math.max(1, sampleLen);
  const costed = estimates.map((e) => {
    const tCompress = e.sampleMs * scale;
    const tDecompress = (e.sampleMs * 0.4) * scale; // décompression ~2,5× plus rapide (constat, pas garantie)
    const tTransfer = ((size * e.ratio) / bps) * 1000 + rttMs / 2;
    return { ...e, tCompress, costMs: tCompress + tTransfer + tDecompress };
  });
  const rawCost = (size / bps) * 1000 + rttMs / 2;
  let best = { codec: 'raw', ratio: 1, costMs: rawCost };
  for (const c of costed) {
    if (c.ratio > 0.95) continue; // incompressible : jamais rentable
    if (c.tCompress > maxCompressMs) continue; // budget CPU dépassé
    const gain = (rawCost - c.costMs) / Math.max(1e-9, rawCost);
    if (effort === 'eco' && c.ratio >= 0.5) continue;
    if (effort !== 'performance' && gain < 0.05) continue;
    if (effort === 'performance') {
      if (c.ratio < best.ratio && c.tCompress <= maxCompressMs) best = c;
    } else if (c.costMs < best.costMs) {
      best = c;
    }
  }
  if (best.codec === 'raw') {
    const why = estimates.length ? 'gain-insuffisant' : 'aucun-codec';
    return { codec: 'raw', reason: why, ratio: 1, costMs: rawCost };
  }
  return { codec: best.codec, reason: `coût-min (${best.costMs.toFixed(1)} ms vs ${rawCost.toFixed(1)} brut)`, ratio: best.ratio, costMs: best.costMs };
}

module.exports = { EFFORTS, selectEncoding };

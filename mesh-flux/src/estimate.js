'use strict';

/**
 * Estimation NT-Flux : détection du déjà-compressé + échantillonnage borné.
 * - Magies : gzip 1f8b, zlib 78(01|9c|da), zip PK\x03\x04, png, jpeg, brotli
 *   sans magie fiable (non détecté comme compressé — assumé, documenté).
 * - Échantillon : tête + queue, 64 Ko max par défaut (jamais le tout).
 * - Ratio > 0,95 sur échantillon ⇒ incompressible (raw).
 */

const { CODECS } = require('./codecs');

const MAGIC = [
  { codec: 'gzip', bytes: [0x1f, 0x8b] },
  { codec: 'zlib', bytes: [0x78, 0x01] },
  { codec: 'zlib', bytes: [0x78, 0x9c] },
  { codec: 'zlib', bytes: [0x78, 0xda] },
  { codec: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { codec: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { codec: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
];

function detectMagic(buf) {
  for (const m of MAGIC) {
    if (m.bytes.every((b, i) => buf[i] === b)) return m.codec;
  }
  return null;
}

/** Échantillon tête+queue (borné, sans allocation du tout). */
function sampleOf(buf, sampleBytes = 65536) {
  if (buf.length <= sampleBytes) return buf;
  const half = Math.floor(sampleBytes / 2);
  return Buffer.concat([buf.subarray(0, half), buf.subarray(buf.length - half)]);
}

/**
 * Estime le ratio (transmis/initial) par codec sur l'échantillon.
 * Retourne [{codec, ratio, sampleMs}] + incompressible booléen.
 */
function estimateRatios(buf, { codecs = ['deflate', 'gzip', 'brotli'], sampleBytes = 65536 } = {}) {
  const sample = sampleOf(buf, sampleBytes);
  const out = [];
  for (const name of codecs) {
    const c = CODECS[name];
    if (!c || !c.available) continue;
    const { data, timeMs } = c.compress(sample);
    out.push({ codec: name, ratio: data.length / Math.max(1, sample.length), sampleMs: timeMs });
  }
  return out;
}

module.exports = { MAGIC, detectMagic, sampleOf, estimateRatios };

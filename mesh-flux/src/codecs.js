'use strict';

/**
 * Codecs NT-Flux : registre fermé, tous SANS PERTE, zéro dépendance.
 * - raw : identité (repli universel, jamais indisponible).
 * - deflate / gzip / brotli : `node:zlib` (socle Node, justifié par la
 *   sonde 2026-10-26 : codecs natifs lz4/zstd incompatibles ici sans
 *   toolchain — voir docs/OUTILLAGE.md §3b, classés [RECHERCHE]).
 * Niveaux : compromis vitesse/ratio documentés (deflate 6, gzip 6,
 * brotli 4). Aucun dictionnaire partagé : codecs sans état (pas de
 * mélange inter-tâches possible — voir docs/NT_FLUX_SECURITY.md).
 */

const zlib = require('node:zlib');

function timed(fn) {
  const t0 = process.hrtime.bigint();
  const data = fn();
  return { data, timeMs: Number(process.hrtime.bigint() - t0) / 1e6 };
}

const CODECS = {
  raw: {
    name: 'raw',
    lossless: true,
    available: true,
    compress: (buf) => ({ data: Buffer.from(buf), timeMs: 0 }),
    decompress: (buf) => ({ data: Buffer.from(buf), timeMs: 0 }),
  },
  deflate: {
    name: 'deflate',
    lossless: true,
    available: true,
    compress: (buf) => timed(() => zlib.deflateSync(buf, { level: 6 })),
    decompress: (buf) => timed(() => zlib.inflateSync(buf)),
  },
  gzip: {
    name: 'gzip',
    lossless: true,
    available: true,
    compress: (buf) => timed(() => zlib.gzipSync(buf, { level: 6 })),
    decompress: (buf) => timed(() => zlib.gunzipSync(buf)),
  },
  brotli: {
    name: 'brotli',
    lossless: true,
    available: true,
    compress: (buf) => timed(() => zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })),
    decompress: (buf) => timed(() => zlib.brotliDecompressSync(buf)),
  },
};

/** Taille annoncée AVANT gonflement (gzip ISIZE, modulo 2^32). */
function announcedSize(codec, buf) {
  if (codec === 'gzip' && buf.length >= 18) {
    return buf.readUInt32LE(buf.length - 4);
  }
  return null; // deflate/brotli/raw : taille inconnue avant gonflement
}

module.exports = { CODECS, announcedSize };

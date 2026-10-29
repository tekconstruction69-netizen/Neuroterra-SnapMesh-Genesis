'use strict';

/**
 * Génère les icônes PWA (PNG réels, sans dépendance) : fond vert foncé,
 * lettre N blanche en police pixel 5x7 mise à l'échelle.
 * Usage : node scripts/gen-pwa-icons.js
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const GLYPH_N = [
  '10001', '11001', '10101', '10011', '10001', '10001', '10001',
];

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const scale = Math.floor(size / 8);
  const off = Math.floor((size - scale * 5) / 2);
  const oy = Math.floor((size - scale * 7) / 2);
  for (let y = 0; y < size; y++) {
    let p = y * (size * 4 + 1);
    raw[p++] = 0; // filtre none
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - off) / scale);
      const gy = Math.floor((y - oy) / scale);
      const on = gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && GLYPH_N[gy][gx] === '1';
      raw[p++] = on ? 255 : 0x1d;
      raw[p++] = on ? 255 : 0x4d;
      raw[p++] = on ? 255 : 0x2b;
      raw[p++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'mesh-app', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, png(size));
  console.log(`${name} : ${fs.statSync(file).size} octets`);
}

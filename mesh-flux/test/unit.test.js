'use strict';

/** Tests unitaires NT-Flux : codecs, estimation, politique, dedup, contrat. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const { CODECS, announcedSize } = require('../src/codecs');
const { detectMagic, estimateRatios } = require('../src/estimate');
const { selectEncoding } = require('../src/policy');
const { DedupStore, hashOf } = require('../src/dedup');
const { pack, unpack } = require('../src/flux');
const { FLUX_V, buildFluxInput, validateFluxPolicy, heuristicFlux, museProposeFlux } = require('../src/muse');

const FR_TEXT = ('Bonjour le monde distribué, république des nœuds laborieux. '.repeat(2000));
const TXT_BUF = Buffer.from(FR_TEXT, 'utf8');
// Pseudo-aléatoire incompressible : xorshift déterministe (pas de hasard en test).
const INC_BUF = (() => {
  let s = 0x12345678;
  const b = Buffer.alloc(32768);
  for (let i = 0; i < b.length; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    b[i] = s & 0xff;
  }
  return b;
})();

test('codecs : roundtrip exact, tous lossless, tailles annoncées gzip', () => {
  for (const name of ['raw', 'deflate', 'gzip', 'brotli']) {
    const c = CODECS[name];
    assert.equal(c.available, true);
    assert.equal(c.lossless, true);
    const { data } = c.compress(TXT_BUF);
    assert.deepEqual(c.decompress(data).data, TXT_BUF, `roundtrip ${name}`);
    if (name !== 'raw') assert.ok(data.length < TXT_BUF.length, `${name} ne compresse pas le texte`);
  }
  const gz = CODECS.gzip.compress(TXT_BUF).data;
  assert.equal(announcedSize('gzip', gz), TXT_BUF.length, 'ISIZE gzip exact');
  assert.equal(announcedSize('brotli', Buffer.alloc(10)), null, 'brotli sans taille annoncée');
});

test('estimation : magies détectées, ratio échantillon cohérent', () => {
  assert.equal(detectMagic(CODECS.gzip.compress(TXT_BUF).data), 'gzip');
  assert.equal(detectMagic(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])), 'zip');
  assert.equal(detectMagic(TXT_BUF), null, 'texte faussement détecté');
  const est = estimateRatios(TXT_BUF);
  const def = est.find((e) => e.codec === 'deflate');
  assert.ok(def.ratio < 0.2, `ratio texte inattendu : ${def.ratio}`);
  const estInc = estimateRatios(INC_BUF);
  assert.ok(estInc.every((e) => e.ratio > 0.95), 'aléatoire jugé compressible');
});

test('politique : compressible→codec, incompressible/déjà-compressé→raw', () => {
  const net = { bytesPerSec: 1024 * 1024, rttMs: 1 };
  const c1 = selectEncoding(TXT_BUF, { net });
  assert.notEqual(c1.codec, 'raw', `texte non compressé : ${c1.reason}`);
  assert.ok(c1.ratio < 0.5);
  const c2 = selectEncoding(INC_BUF, { net });
  assert.equal(c2.codec, 'raw', 'aléatoire compressé pour rien');
  const c3 = selectEncoding(CODECS.gzip.compress(TXT_BUF).data, { net });
  assert.equal(c3.codec, 'raw');
  assert.match(c3.reason, /déjà-compressé/);
  const c4 = selectEncoding(TXT_BUF, { net, effort: 'eco' });
  assert.ok(['raw', 'deflate', 'gzip', 'brotli'].includes(c4.codec));
  const c5 = selectEncoding(Buffer.alloc(0), { net });
  assert.equal(c5.codec, 'raw');
});

test('pack/unpack : enveloppe + métriques réelles, sans état inter-tâches', () => {
  const e1 = pack(TXT_BUF, { net: { bytesPerSec: 1024 * 1024 } });
  assert.equal(e1.origBytes, TXT_BUF.length);
  assert.ok(e1.metrics.outBytes < e1.metrics.inBytes);
  assert.ok(typeof e1.metrics.tPackMs === 'number');
  const { data } = unpack(e1);
  assert.deepEqual(data, TXT_BUF);
  // Deux packs du même contenu : pas de contexte partagé (stateless).
  // Note : l'égalité des OCTETS n'est pas exigée — le départage gzip /
  // deflate / brotli utilise les temps mesurés (fluctuants sous charge) ;
  // c'est la politique, pas un état. Seule l'exactitude est déterministe.
  const e2 = pack(TXT_BUF, { net: { bytesPerSec: 1024 * 1024 } });
  assert.deepEqual(unpack(e2).data, TXT_BUF, 'second pack inexact');
  assert.ok(['deflate', 'gzip', 'brotli'].includes(e2.codec), `codec inattendu : ${e2.codec}`);
});

test('sécurité : bombe gzip refusée SANS gonfler, ratio suspect, codec inconnu', () => {
  const bomb = zlib.gzipSync(Buffer.alloc(3 * 1024 * 1024, 0x41)); // 3 Mo de 'A' → ~3 Ko
  assert.ok(bomb.length < 10 * 1024, 'bombe mal formée');
  const mem0 = process.memoryUsage().heapUsed;
  assert.throws(() => unpack({ encoding: 'flux', codec: 'gzip', data: bomb.toString('base64') }, { maxDecompressedBytes: 1024 * 1024 }), /flux-bombe/);
  const mem1 = process.memoryUsage().heapUsed;
  assert.ok(mem1 - mem0 < 512 * 1024, `bombe gonflée avant refus (+${((mem1 - mem0) / 1024) | 0} Ko)`);
  assert.throws(() => unpack({ encoding: 'flux', codec: 'lz4-mirage', data: 'eA==' }), /codec inconnu/);
  assert.throws(() => unpack({ encoding: 'flux', codec: 'deflate', data: Buffer.from('x'.repeat(100)).toString('base64') }), /flux-|invalid|incorrect/);
  // Ratio extrême légitime : signalé, pas bloqué (brotli > 1000× sur répétitions).
  const leg = pack(TXT_BUF, { net: { bytesPerSec: 1024 * 1024 } });
  const back = unpack(leg);
  assert.deepEqual(back.data, TXT_BUF);
  assert.ok(back.metrics.ratio > 1, 'ratio mesuré absent');
});

test('dedup : put/get, quotas, expiration, intégrité', async () => {
  const s = new DedupStore({ maxEntries: 2, maxBytes: 1000, ttlMs: 50 });
  const a = Buffer.from('fragment-alpha');
  const { hash } = s.put(a);
  assert.equal(hash, hashOf(a));
  assert.deepEqual(s.get(hash), a);
  assert.equal(s.put(a).duplicate, true, 'doublon non détecté');
  assert.equal(s.put(Buffer.alloc(2000)).stored, false, 'quota octets ignoré');
  s.put(Buffer.from('b')); // 2 entrées
  s.put(Buffer.from('c')); // évince la plus ancienne (alpha)
  assert.equal(s.get(hash), null, 'éviction FIFO manquante');
  assert.equal(s.stats.evicted, 1);
  const hd = s.put(Buffer.from('d')).hash; // 'd' évince à son tour ('b' parti)
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(s.get(hd), null, 'expiration TTL manquante');
  assert.equal(s.stats.expired >= 1, true);
  // Corruption : jamais servie.
  const s2 = new DedupStore();
  const h = s2.put(Buffer.from('sain')).hash;
  s2.map.get(h).data[0] ^= 1;
  assert.equal(s2.get(h), null);
  assert.equal(s2.stats.corrupt, 1);
});

test('contrat Muse : entrée, arbitre, heuristique, repli adaptateur', async () => {
  const input = buildFluxInput({
    fragment: { sizeBytes: 50000, dataType: 'texte', entropyHint: 0.1, requiresExact: true },
    nodeCaps: { codecs: ['raw', 'deflate'], cpu: 'x64-8' },
    net: { rttMs: 2, bytesPerSec: 512 * 1024 },
    budgets: { maxCompressMs: 500 },
    options: { dedup: true, effort: 'normal' },
  });
  assert.equal(input.v, FLUX_V);
  const h = heuristicFlux(input);
  assert.equal(validateFluxPolicy(h, { supportedCodecs: ['raw', 'deflate', 'gzip', 'brotli'] }).ok, true);
  assert.equal(validateFluxPolicy({ ...h, effort: 'turbo' }).ok, false);
  assert.equal(validateFluxPolicy({ ...h, allowLossy: true }).ok, false, 'avec-perte accepté malgré exactitude');
  const small = buildFluxInput({ fragment: { sizeBytes: 100 }, nodeCaps: {}, net: {}, budgets: {}, options: {} });
  assert.equal(heuristicFlux(small).effort, 'eco', 'petit fragment non eco');
  // Adaptateur : sans config → repli ; stub valide → muse ; stub pourri → repli.
  const r1 = await museProposeFlux(input, {});
  assert.equal(r1.provider, 'heuristic');
  const fetchOk = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ v: 1, effort: 'performance', dedup: false, maxCompressMs: 200, codecs: ['raw', 'deflate'], allowLossy: false, confidence: 0.8, explanation: 'stub' }) } }] }),
  });
  const r2 = await museProposeFlux(input, { fetchImpl: fetchOk, apiUrl: 'http://x', apiKey: 'k' });
  assert.equal(r2.provider, 'muse');
  assert.equal(r2.policy.effort, 'performance');
  const fetchBad = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'nope' } }] }) });
  const r3 = await museProposeFlux(input, { fetchImpl: fetchBad, apiUrl: 'http://x', apiKey: 'k' });
  assert.equal(r3.provider, 'heuristic');
});

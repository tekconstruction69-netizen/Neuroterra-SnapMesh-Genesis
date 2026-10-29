'use strict';

/**
 * Benchmark NT-Flux §7 (niveaux mesurés honnêtement).
 * Bras : A brut · B systématique (deflate toujours) · C adaptatif (policy) ·
 *        D adaptatif + dedup (2e passe = ref 64 o).
 * Mesuré : taille initiale/transmise, tPack, tUnpack, CPU et mémoire
 * observables (process.cpuUsage/memoryUsage). Énergie : [RECHERCHE].
 * Le transport est une copie mémoire (pas de socket : sandbox sans listen)
 * → le temps réseau réel sera mesuré hors sandbox (flux-e2e). Chaque passe
 * inclut quand même pack + copie + unpack + vérification d'intégrité.
 * Usage : node scripts/bench-ntflux.js --reps 5 [--out bench-logs/...json]
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const { pack, unpack } = require('../mesh-flux/src/flux');
const { CODECS } = require('../mesh-flux/src/codecs');
const { DedupStore, hashOf } = require('../mesh-flux/src/dedup');

const repsOf = (() => {
  const i = process.argv.indexOf('--reps');
  return i === -1 ? 5 : Math.max(1, Number(process.argv[i + 1]) || 5);
})();
const outOf = (() => {
  const i = process.argv.indexOf('--out');
  return i === -1 ? null : process.argv[i + 1];
})();

function gen(kind, size) {
  if (kind === 'texte') return Buffer.from('ligne de texte compressible pour NT-Flux 0123456789\n'.repeat(Math.ceil(size / 52)).slice(0, size));
  if (kind === 'json') {
    const row = { id: 12345, nom: 'capteur-mesh-abcdef', valeurs: [1.5, 2.5, 3.5], actif: true, note: 'mesure périodique du maillage local' };
    const arr = [];
    while (Buffer.byteLength(JSON.stringify(arr)) < size) arr.push(row);
    return Buffer.from(JSON.stringify(arr).slice(0, size));
  }
  if (kind === 'aleatoire') return crypto.randomBytes(size);
  if (kind === 'gzip') {
    const inner = Buffer.from('contenu déjà compressé祖 '.repeat(Math.ceil(size * 4 / 30)));
    return require('node:zlib').gzipSync(inner).slice(0, Math.max(size, 64));
  }
  throw new Error(`type inconnu: ${kind}`);
}

/** Passe A : brut (copie). */
function runA(buf) {
  const t0 = process.hrtime.bigint();
  const wire = Buffer.from(buf);
  const t1 = process.hrtime.bigint();
  const back = Buffer.from(wire);
  const t2 = process.hrtime.bigint();
  if (!back.equals(buf)) throw new Error('intégrité A');
  return { sent: wire.length, tPackMs: Number(t1 - t0) / 1e6, tUnpackMs: Number(t2 - t1) / 1e6 };
}

/** Passe B : deflate systématique (même sans gain). */
function runB(buf) {
  const c = CODECS.deflate;
  const t0 = process.hrtime.bigint();
  const { data } = c.compress(buf);
  const t1 = process.hrtime.bigint();
  const wire = Buffer.from(JSON.stringify({ codec: 'deflate', data: data.toString('base64') }));
  const back = c.decompress(Buffer.from(JSON.parse(wire.toString()).data, 'base64')).data;
  const t2 = process.hrtime.bigint();
  if (!back.equals(buf)) throw new Error('intégrité B');
  return { sent: wire.length, tPackMs: Number(t1 - t0) / 1e6, tUnpackMs: Number(t2 - t1) / 1e6 };
}

/** Passe C : adaptatif (pack/unpack réels). Fidèle à _fluxTaskBody :
 *  décision raw ⇒ args plains SANS enveloppe (zéro surcoût base64). */
function runC(buf) {
  const t0 = process.hrtime.bigint();
  const env = pack(buf, { effort: 'normal' });
  const t1 = process.hrtime.bigint();
  let wire, back, t2;
  if (env.codec === 'raw') {
    wire = Buffer.from(buf); // plains, comme _fluxTaskBody
    back = Buffer.from(wire);
    t2 = process.hrtime.bigint();
  } else {
    wire = Buffer.from(JSON.stringify(env));
    back = unpack(JSON.parse(wire.toString())).data;
    t2 = process.hrtime.bigint();
  }
  if (!back.equals(buf)) throw new Error('intégrité C');
  return { sent: wire.length, codec: env.codec, tPackMs: Number(t1 - t0) / 1e6, tUnpackMs: Number(t2 - t1) / 1e6 };
}

/** Passe D : C puis 2e envoi identique en ref (store réel, ack simulé par get). */
function runD(buf, store) {
  const first = runC(buf);
  const h = hashOf(buf);
  store.put(buf); // plein reçu et accusé (cf. flux-wire.test.js pour l'ack réseau)
  const t0 = process.hrtime.bigint();
  const got = store.get(h); // ref résolue côté destinataire (64 o sur le fil)
  const t1 = process.hrtime.bigint();
  if (!got || !got.equals(buf)) throw new Error('intégrité D (ref)');
  return { ...first, secondSent: h.length, tRefMs: Number(t1 - t0) / 1e6 };
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, min: s[0], med: s[(s.length - 1) >> 1], max: s[s.length - 1], mean };
}

const kinds = ['texte', 'json', 'aleatoire', 'gzip'];
const sizes = [1024, 16 * 1024, 64 * 1024, 256 * 1024];
const rows = [];

for (const kind of kinds) {
  for (const size of sizes) {
    const buf = gen(kind, size);
    const cpu0 = process.cpuUsage();
    const mem0 = process.memoryUsage().heapUsed;
    const cell = { type: kind, octets: buf.length, bras: {} };
    for (const [arm, fn] of [['A', runA], ['B', runB], ['C', runC]]) {
      const sent = [], tp = [], tu = [], codecs = new Set();
      for (let r = 0; r < repsOf; r++) {
        const m = fn(buf);
        sent.push(m.sent);
        tp.push(m.tPackMs);
        tu.push(m.tUnpackMs);
        if (m.codec) codecs.add(m.codec);
      }
      cell.bras[arm] = { transmis: stats(sent), tPackMs: stats(tp), tUnpackMs: stats(tu), ...(codecs.size ? { codec: [...codecs].join(',') } : {}) };
    }
    {
      const store = new DedupStore({});
      const sent2 = [], tr = [];
      let first = null;
      for (let r = 0; r < repsOf; r++) {
        const m = runD(buf, store);
        if (!first) first = m;
        sent2.push(m.secondSent);
        tr.push(m.tRefMs);
      }
      cell.bras.D = { premier: { transmis: first.sent, codec: first.codec || 'n/a' }, secondeRef: stats(sent2), tRefMs: stats(tr) };
    }
    const dCpu = process.cpuUsage(cpu0);
    cell.cpuMs = (dCpu.user + dCpu.system) / 1000;
    cell.memDeltaOctets = process.memoryUsage().heapUsed - mem0;
    rows.push(cell);
  }
}

const report = {
  module: 'NT-Flux',
  date: new Date().toISOString(),
  node: process.version,
  plateforme: process.platform,
  reps: repsOf,
  limites: 'transport = copie mémoire (sandbox sans listen) ; réseau réel mesuré hors sandbox via flux-e2e ; énergie non mesurée [RECHERCHE]',
  resultats: rows,
};

const line = (c) => {
  const f = (o) => `${o.transmis.med} o (moy ${o.transmis.mean.toFixed(0)})`;
  return `${c.type} ${c.octets} o : A=${f(c.bras.A)} B=${f(c.bras.B)} C=${f(c.bras.C)} [${c.bras.C.codec || '?'}] D2e=${c.bras.D.secondeRef.med} o packC=${c.bras.C.tPackMs.med.toFixed(2)}ms unpackC=${c.bras.C.tUnpackMs.med.toFixed(2)}ms`;
};
for (const c of rows) console.log(line(c));
if (outOf) {
  fs.writeFileSync(outOf, JSON.stringify(report, null, 2));
  console.log(`rapport : ${outOf}`);
} else {
  console.log(JSON.stringify(report));
}

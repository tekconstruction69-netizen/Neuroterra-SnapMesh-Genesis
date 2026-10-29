'use strict';

/**
 * Fragmenter intelligent §5 : tâches DAG versionnées, merge nommé, presets.
 *
 * Un DAG = { v:1, jobId?, merge: 'nom', fragments: [{ v:1, id, op, args,
 *   deps:[], minRes:{cpus?, memFreeBytes?}, timeoutMs, expiryMs,
 *   validation:{strategy:'single'|'quorum', redundancy} }] }.
 * - `op` : clé de la liste blanche `ops.js` (jamais de code arbitraire).
 * - `args` : objet ; toute valeur `{$ref:'id'}` ou `{$ref:'id.chemin'}}`
 *   est remplacée par le résultat du fragment dépendant (cible ∈ deps).
 * - `merge` : nom de `MERGES` (jamais de fonction transmise).
 * - `expiryMs` : échéance du fragment depuis le début du job.
 */

const { listOps } = require('./ops');

const FRAG_V = 1;

const MERGES = {
  /** Chaîne : le résultat final est celui du dernier fragment. */
  last: (ordered) => ordered[ordered.length - 1].value,
  /** Lots : concatène les résultats dans l'ordre des fragments. */
  concat: (ordered) => ordered.flatMap((f) => (Array.isArray(f.value) ? f.value : [f.value])),
  /** Nombres : somme (lots homogènes). */
  sum: (ordered) => ordered.reduce((t, f) => t + f.value, 0),
  /**
   * Recolle un wordcount découpé par lignes : mots et caractères
   * s'additionnent (+ séparateurs `\n` entre parts). Pour les lignes,
   * chaque part non vide comptait `retours+1` et chaque part vide `0`
   * (cas spécial de l'op) : total = somme + nombre de parts vides.
   * Texte vide (0 caractère) : 0 ligne.
   */
  wordcount: (ordered, nparts) => {
    const words = ordered.reduce((t, f) => t + f.value.words, 0);
    const chars = ordered.reduce((t, f) => t + f.value.chars, 0) + (nparts - 1);
    if (chars === 0) return { words, lines: 0, chars };
    const empty = ordered.filter(
      (f) => f.value.words === 0 && f.value.lines === 0 && f.value.chars === 0
    ).length;
    const lines = ordered.reduce((t, f) => t + f.value.lines, 0) + empty;
    return { words, lines, chars };
  },
};

function isObj(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o);
}

/** Collecte les $ref d'un args (profond). */
function collectRefs(args, out = []) {
  if (Array.isArray(args)) {
    for (const v of args) collectRefs(v, out);
  } else if (isObj(args)) {
    if (typeof args.$ref === 'string' && Object.keys(args).length === 1) out.push(args.$ref);
    else for (const v of Object.values(args)) collectRefs(v, out);
  }
  return out;
}

/** Remplace les $ref par les résultats déjà obtenus. */
function substituteRefs(args, results) {
  if (Array.isArray(args)) return args.map((v) => substituteRefs(v, results));
  if (isObj(args)) {
    if (typeof args.$ref === 'string' && Object.keys(args).length === 1) {
      const [id, ...rest] = args.$ref.split('.');
      if (!results.has(id)) throw new Error(`ref-manquante: ${args.$ref}`);
      let v = results.get(id);
      for (const k of rest) {
        if (!isObj(v) && !Array.isArray(v)) throw new Error(`ref-chemin-invalide: ${args.$ref}`);
        v = v[k];
      }
      if (v === undefined) throw new Error(`ref-chemin-invalide: ${args.$ref}`);
      return v;
    }
    return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, substituteRefs(v, results)]));
  }
  return args;
}

function validateDag(dag) {
  if (!isObj(dag)) throw new Error('dag-invalide: objet requis');
  if (dag.v !== FRAG_V) throw new Error(`dag-invalide: v attendue ${FRAG_V}`);
  if (!Array.isArray(dag.fragments) || !dag.fragments.length) throw new Error('dag-invalide: fragments non vide requis');
  if (!MERGES[dag.merge]) throw new Error(`dag-invalide: merge inconnu ${dag.merge}`);
  const ops = listOps();
  const ids = new Set();
  for (const f of dag.fragments) {
    if (!isObj(f) || typeof f.id !== 'string' || !f.id) throw new Error('dag-invalide: fragment avec id requis');
    if (ids.has(f.id)) throw new Error(`dag-invalide: id dupliqué ${f.id}`);
    ids.add(f.id);
  }
  for (const f of dag.fragments) {
    if (!ops[f.op]) throw new Error(`dag-invalide: op inconnue ${f.op} (fragment ${f.id})`);
    if (!isObj(f.args)) throw new Error(`dag-invalide: args objet requis (fragment ${f.id})`);
    if (!Array.isArray(f.deps)) throw new Error(`dag-invalide: deps tableau requis (fragment ${f.id})`);
    for (const d of f.deps) {
      if (d === f.id) throw new Error(`dag-invalide: auto-dépendance ${f.id}`);
      if (!ids.has(d)) throw new Error(`dag-invalide: dep inconnue ${d} (fragment ${f.id})`);
    }
    for (const r of collectRefs(f.args)) {
      const rid = r.split('.')[0];
      if (!f.deps.includes(rid)) throw new Error(`dag-invalide: $ref ${r} hors deps (fragment ${f.id})`);
    }
    if (f.minRes !== undefined) {
      if (!isObj(f.minRes)) throw new Error(`dag-invalide: minRes objet (fragment ${f.id})`);
      if (f.minRes.cpus !== undefined && (!Number.isInteger(f.minRes.cpus) || f.minRes.cpus < 1)) {
        throw new Error(`dag-invalide: minRes.cpus entier ≥ 1 (fragment ${f.id})`);
      }
      if (f.minRes.memFreeBytes !== undefined && (!Number.isInteger(f.minRes.memFreeBytes) || f.minRes.memFreeBytes < 0)) {
        throw new Error(`dag-invalide: minRes.memFreeBytes entier ≥ 0 (fragment ${f.id})`);
      }
    }
    if (!Number.isInteger(f.timeoutMs) || f.timeoutMs < 100 || f.timeoutMs > 120000) {
      throw new Error(`dag-invalide: timeoutMs 100..120000 (fragment ${f.id})`);
    }
    if (!Number.isInteger(f.expiryMs) || f.expiryMs <= 0) {
      throw new Error(`dag-invalide: expiryMs > 0 (fragment ${f.id})`);
    }
    const v = f.validation || { strategy: 'single', redundancy: 1 };
    if (!['single', 'quorum'].includes(v.strategy)) throw new Error(`dag-invalide: stratégie inconnue (fragment ${f.id})`);
    if (!Number.isInteger(v.redundancy) || v.redundancy < 1 || v.redundancy > 5) {
      throw new Error(`dag-invalide: redundancy 1..5 (fragment ${f.id})`);
    }
  }
  // Cycles : tri de Kahn.
  topoOrder(dag);
  return true;
}

/** Ordre topologique (lève sur cycle). */
function topoOrder(dag) {
  const byId = new Map(dag.fragments.map((f) => [f.id, f]));
  const indeg = new Map(dag.fragments.map((f) => [f.id, 0]));
  for (const f of dag.fragments) {
    for (const d of f.deps) indeg.set(f.id, indeg.get(f.id) + 1);
  }
  const ready = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const f of dag.fragments) {
      if (f.deps.includes(id)) {
        indeg.set(f.id, indeg.get(f.id) - 1);
        if (indeg.get(f.id) === 0) ready.push(f.id);
      }
    }
  }
  if (order.length !== dag.fragments.length) throw new Error('dag-invalide: cycle détecté');
  return order.map((id) => byId.get(id));
}

/** Candidats satisfaisant minRes (échec fermé si mémoire exigée et inconnue). */
function eligibleIds(candidates, minRes = {}) {
  return candidates
    .filter((c) => {
      if (minRes.cpus && (c.cpus || 1) < minRes.cpus) return false;
      if (minRes.memFreeBytes !== undefined) {
        if (c.memFreeBytes === undefined || c.memFreeBytes === null) return false;
        if (c.memFreeBytes < minRes.memFreeBytes) return false;
      }
      return true;
    })
    .map((c) => c.id);
}

// ---------- presets : charges réellement parallélisables ----------

/** Chaîne de produits matriciels : f0 = M0×M1, fi = f(i-1)×M(i+1). */
function buildChainMatmul(matrices, { timeoutMs = 8000, expiryMs = 60000 } = {}) {
  if (!Array.isArray(matrices) || matrices.length < 2) throw new Error('preset: au moins 2 matrices');
  const fragments = [];
  for (let i = 1; i < matrices.length; i++) {
    fragments.push({
      v: FRAG_V,
      id: `mm-${i - 1}`,
      op: 'matmul',
      args: i === 1 ? { a: matrices[0], b: matrices[1] } : { a: { $ref: `mm-${i - 2}` }, b: matrices[i] },
      deps: i === 1 ? [] : [`mm-${i - 2}`],
      timeoutMs,
      expiryMs,
      validation: { strategy: 'single', redundancy: 1 },
    });
  }
  return { v: FRAG_V, merge: 'last', fragments };
}

/** Lot de Fibonacci indépendants (parallélisme maximal). */
function buildBatchFib(ns, { timeoutMs = 8000, expiryMs = 60000, redundancy = 1 } = {}) {
  if (!Array.isArray(ns) || !ns.length) throw new Error('preset: ns non vide requis');
  return {
    v: FRAG_V,
    merge: 'concat',
    fragments: ns.map((n, i) => ({
      v: FRAG_V, id: `fib-${i}`, op: 'fib', args: { n },
      deps: [], timeoutMs, expiryMs,
      validation: { strategy: redundancy > 1 ? 'quorum' : 'single', redundancy },
    })),
  };
}

/** Découpe un texte par lignes en parts ~égales (recolle exact, cf. MERGES.wordcount). */
function buildSplitWordcount(text, parts, { timeoutMs = 8000, expiryMs = 60000 } = {}) {
  if (typeof text !== 'string') throw new Error('preset: text chaîne requise');
  if (!Number.isInteger(parts) || parts < 1) throw new Error('preset: parts ≥ 1');
  if (text === '' || parts === 1) {
    return {
      v: FRAG_V,
      merge: 'wordcount',
      fragments: [{ v: FRAG_V, id: 'wc-0', op: 'wordcount', args: { text }, deps: [], timeoutMs, expiryMs, validation: { strategy: 'single', redundancy: 1 } }],
      partCount: 1,
    };
  }
  const lines = text.split('\n');
  const groups = Array.from({ length: parts }, () => []);
  lines.forEach((l, i) => groups[i % parts].push(l));
  const nonEmpty = groups.filter((g) => g.length);
  return {
    v: FRAG_V,
    merge: 'wordcount',
    fragments: nonEmpty.map((g, i) => ({
      v: FRAG_V, id: `wc-${i}`, op: 'wordcount', args: { text: g.join('\n') },
      deps: [], timeoutMs, expiryMs,
      validation: { strategy: 'single', redundancy: 1 },
    })),
    partCount: nonEmpty.length, // le merge doit connaître le vrai nombre de parts
  };
}

module.exports = {
  FRAG_V, MERGES, validateDag, topoOrder, substituteRefs, collectRefs,
  eligibleIds, buildChainMatmul, buildBatchFib, buildSplitWordcount,
};

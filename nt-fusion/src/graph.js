'use strict';

/**
 * NT-FUSION — graphe de calcul typé (DAG) avec contraintes de compatibilité.
 * Nœud : { id, kind, dtype, deps:[], in:{nom: $ref|tenseur}, params?,
 *   backend?, minThreads?, memExtraBytes?, timeoutMs?, retryMax? }.
 * - kinds : input (tenseur constant), matmul, add, cast (conversion
 *   explicite fp32|fp64→fp32|int8 ; toute conversion IMPLICITE = invalide).
 * - dtypes : fp64|fp32|int8. Les opérandes d'un calcul doivent partager
 *   le dtype du nœud, sauf via un nœud `cast` intermédiaire.
 */

const FUSION_V = 1;
const DTYPES = ['fp64', 'fp32', 'int8'];
const KINDS = ['input', 'matmul', 'add', 'cast'];

function isObj(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o);
}

/** Références $node / $node.chemin (chemin ignoré : valeur entière). */
function collectNodeRefs(v, out = []) {
  if (Array.isArray(v)) {
    for (const x of v) collectNodeRefs(x, out);
  } else if (isObj(v)) {
    if (typeof v.$node === 'string' && Object.keys(v).length === 1) out.push(v.$node.split('.')[0]);
    else for (const x of Object.values(v)) collectNodeRefs(x, out);
  }
  return out;
}

function validateGraph(g) {
  if (!isObj(g)) throw new Error('fusion-invalide: objet requis');
  if (g.v !== FUSION_V) throw new Error(`fusion-invalide: v attendue ${FUSION_V}`);
  if (!Array.isArray(g.nodes) || !g.nodes.length) throw new Error('fusion-invalide: nodes non vide requis');
  if (g.nodes.length > 64) throw new Error('fusion-invalide: 64 nœuds max');
  const ids = new Set();
  for (const n of g.nodes) {
    if (!isObj(n) || typeof n.id !== 'string' || !n.id) throw new Error('fusion-invalide: nœud avec id requis');
    if (ids.has(n.id)) throw new Error(`fusion-invalide: id dupliqué ${n.id}`);
    ids.add(n.id);
  }
  for (const n of g.nodes) {
    if (!KINDS.includes(n.kind)) throw new Error(`fusion-invalide: kind inconnu ${n.kind} (${n.id})`);
    if (!DTYPES.includes(n.dtype)) throw new Error(`fusion-invalide: dtype inconnu ${n.dtype} (${n.id})`);
    if (!Array.isArray(n.deps)) throw new Error(`fusion-invalide: deps tableau (${n.id})`);
    for (const d of n.deps) {
      if (d === n.id) throw new Error(`fusion-invalide: auto-dépendance ${n.id}`);
      if (!ids.has(d)) throw new Error(`fusion-invalide: dep inconnue ${d} (${n.id})`);
    }
    if (n.kind === 'input') {
      if (n.deps.length) throw new Error(`fusion-invalide: input sans deps (${n.id})`);
      if (!isObj(n.params) || !Array.isArray(n.params.values)) throw new Error(`fusion-invalide: input.values requis (${n.id})`);
    } else {
      if (!isObj(n.in)) throw new Error(`fusion-invalide: in requis (${n.id})`);
      const refs = collectNodeRefs(n.in);
      if (!refs.length) throw new Error(`fusion-invalide: aucune entrée $node (${n.id})`);
      for (const r of refs) {
        if (!n.deps.includes(r)) throw new Error(`fusion-invalide: $node ${r} hors deps (${n.id})`);
      }
      if (n.kind === 'cast') {
        if (refs.length !== 1) throw new Error(`fusion-invalide: cast à 1 entrée (${n.id})`);
      } else if (refs.length !== 2) {
        throw new Error(`fusion-invalide: ${n.kind} à 2 entrées (${n.id})`);
      }
    }
    if (n.backend !== undefined && typeof n.backend !== 'string') throw new Error(`fusion-invalide: backend chaîne (${n.id})`);
    if (n.timeoutMs !== undefined && (!Number.isInteger(n.timeoutMs) || n.timeoutMs < 50 || n.timeoutMs > 120000)) {
      throw new Error(`fusion-invalide: timeoutMs 50..120000 (${n.id})`);
    }
    if (n.retryMax !== undefined && (!Number.isInteger(n.retryMax) || n.retryMax < 0 || n.retryMax > 3)) {
      throw new Error(`fusion-invalide: retryMax 0..3 (${n.id})`);
    }
  }
  // Types : les opérandes doivent déjà être au dtype du nœud, sinon un
  // cast explicite est exigé entre les deux (conversion implicite interdite).
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const n of g.nodes) {
    if (n.kind === 'input' || n.kind === 'cast') continue;
    for (const r of collectNodeRefs(n.in)) {
      const src = byId.get(r);
      if (src.dtype !== n.dtype) {
        throw new Error(`fusion-invalide: ${n.id} (${n.dtype}) consomme ${r} (${src.dtype}) sans cast`);
      }
    }
  }
  topoOrder(g); // lève sur cycle
  return true;
}

/** Ordre topologique (Kahn, lève sur cycle). */
function topoOrder(g) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const indeg = new Map(g.nodes.map((n) => [n.id, 0]));
  for (const n of g.nodes) {
    for (const d of n.deps) indeg.set(n.id, indeg.get(n.id) + 1);
  }
  const ready = [...indeg.entries()].filter(([, k]) => k === 0).map(([id]) => id);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const n of g.nodes) {
      if (n.deps.includes(id)) {
        indeg.set(n.id, indeg.get(n.id) - 1);
        if (indeg.get(n.id) === 0) ready.push(n.id);
      }
    }
  }
  if (order.length !== g.nodes.length) throw new Error('fusion-invalide: cycle détecté');
  return order.map((id) => byId.get(id));
}

/** Octets d'un tenseur logique {shape, dtype}. */
function tensorBytes(shape, dtype) {
  const per = dtype === 'fp64' ? 8 : dtype === 'fp32' ? 4 : 1;
  return shape.reduce((a, b) => a * b, 1) * per;
}

/**
 * Infère la shape de chaque nœud depuis les inputs (lève si incohérent).
 * Retourne Map(id -> shape). matmul [ar,ac]·[br,bc] exige ac==br.
 */
function inferShapes(g) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const shapes = new Map();
  const shapeOf = (ref) => {
    const id = ref.split('.')[0];
    const s = shapes.get(id);
    if (!s) throw new Error(`fusion-invalide: shape inconnue pour ${ref}`);
    return s;
  };
  for (const n of topoOrder(g)) {
    if (n.kind === 'input') {
      const v = n.params.values;
      const r = v.length;
      const c = Array.isArray(v[0]) ? v[0].length : 1;
      for (const row of v) {
        const len = Array.isArray(row) ? row.length : 1;
        if (len !== c) throw new Error(`fusion-invalide: input irrégulier ${n.id}`);
      }
      shapes.set(n.id, c === 1 && !Array.isArray(v[0]) ? [r, 1] : [r, c]);
      continue;
    }
    const ins = n.in;
    if (n.kind === 'cast') {
      const keys = Object.keys(ins);
      shapes.set(n.id, shapeOf(ins[keys[0]].$node));
      continue;
    }
    const keys = Object.keys(ins);
    const sa = shapeOf(ins[keys[0]].$node);
    const sb = shapeOf(ins[keys[1]].$node);
    if (n.kind === 'add') {
      if (sa[0] !== sb[0] || sa[1] !== sb[1]) throw new Error(`fusion-invalide: add shapes ${sa} vs ${sb} (${n.id})`);
      shapes.set(n.id, [...sa]);
    } else if (n.kind === 'matmul') {
      if (sa[1] !== sb[0]) throw new Error(`fusion-invalide: matmul ${sa}·${sb} (${n.id})`);
      shapes.set(n.id, [sa[0], sb[1]]);
    }
  }
  return shapes;
}

/** Flops estimés depuis les shapes inférées (matmul 2·ar·ac·bc, add/cast n). */
function estimateFlops(n, shapes) {
  if (n.kind === 'input') return 0;
  const s = shapes.get(n.id);
  if (!s) throw new Error(`coût: shape manquante ${n.id}`);
  if (n.kind === 'matmul') {
    // A = première entrée déclarée dans `in` (ordre du graphe, pas deps).
    const firstRef = n.in[Object.keys(n.in)[0]].$node.split('.')[0];
    const a = shapes.get(firstRef);
    return 2 * a[0] * a[1] * s[1];
  }
  return s[0] * s[1];
}

module.exports = { FUSION_V, DTYPES, KINDS, validateGraph, topoOrder, collectNodeRefs, tensorBytes, inferShapes, estimateFlops };

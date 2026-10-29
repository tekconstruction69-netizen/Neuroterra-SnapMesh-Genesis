'use strict';

/**
 * NT-FLOW/M4 — pont NeuroCore → workers M2 (distribué réel).
 * `fusionToDag(graph)` : chaque nœud non-input devient un fragment §5
 * (op blanche tmat/tadd/tmati/tcast, args avec tenseurs constants ou
 * $ref, merge 'last'). Les inputs sont injectés (connus du
 * coordinateur), pas exécutés.
 * `distribute(compute, graph, { jobId })` : submitDag réel + valeur
 * finale + preuves (fragments, faisceaux §7). Bornes : tenseurs carrés
 * ≤ 16 (garde ops.js) ; int8 via tmati (sortie fp32 déquantifiée).
 */

const { validateGraph, topoOrder } = require('../../nt-fusion/src/graph');

function toArray2D(t) {
  const [r, c] = t.shape;
  const out = [];
  for (let i = 0; i < r; i++) {
    const row = [];
    for (let j = 0; j < c; j++) row.push(t.data[i * c + j]);
    out.push(row);
  }
  return out;
}

function tensorOf(node, values) {
  // values : Map id -> tenseur nt-compat (inputs connus du coordinateur).
  const t = values.get(node.id);
  if (!t) throw new Error(`pont: input ${node.id} non fourni`);
  const o = { m: toArray2D(t), dtype: t.dtype === 'int8acc' ? 'int8' : t.dtype };
  if (t.dtype === 'int8') o.scale = t.scale;
  if (t.dtype === 'int8acc') throw new Error('pont: int8acc non transportable (caster avant)');
  return o;
}

/**
 * Convertit un graphe FUSION + ses inputs en DAG §5.
 * inputs : { id -> tenseur nt-compat } (fromArray2D).
 */
function fusionToDag(graph, inputs) {
  validateGraph(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const ten = new Map();
  for (const n of graph.nodes) {
    if (n.kind !== 'input') continue;
    const src = inputs[n.id];
    if (!src) throw new Error(`pont: input ${n.id} manquant`);
    if (src.dtype !== n.dtype) throw new Error(`pont: input ${n.id} dtype ${src.dtype} ≠ ${n.dtype}`);
    ten.set(n.id, { m: toArray2D(src), dtype: src.dtype, ...(src.scale ? { scale: src.scale } : {}) });
  }
  // Type de sortie de chaque fragment (tmati sort fp32, les autres
  // conservent le dtype du nœud). Les casts devenus identités (ex.
  // tmati→fp32 suivi d'un cast→fp32) sont ÉLIMINÉS avec alias
  // (sémantique conservée, documenté) — tcast l'interdit.
  const outDtype = (n) => {
    if (n.kind === 'matmul' && n.dtype === 'int8') return 'fp32'; // tmati
    return n.dtype;
  };
  const alias = new Map(); // nodeId -> fragment cible (cast identité éliminé)
  const resolve = (id) => {
    while (alias.has(id)) id = alias.get(id);
    return id;
  };
  const ref = (id) => {
    const rid = resolve(id);
    if (byId.get(rid).kind === 'input') return ten.get(rid);
    return { $ref: rid };
  };
  const fragments = [];
  for (const n of topoOrder(graph)) {
    if (n.kind === 'input') continue;
    const keys = Object.keys(n.in);
    const inIds = keys.map((k) => n.in[k].$node.split('.')[0]);
    if (n.kind === 'cast') {
      const srcOut = outDtype(byId.get(resolve(inIds[0])));
      if (srcOut === n.dtype) {
        alias.set(n.id, resolve(inIds[0])); // identité : réécriture, pas d'op
        continue;
      }
    }
    let op;
    let args;
    if (n.kind === 'matmul' && n.dtype === 'fp32') {
      op = 'tmat';
      args = { x: ref(inIds[0]), y: ref(inIds[1]) };
    } else if (n.kind === 'matmul' && n.dtype === 'int8') {
      op = 'tmati';
      args = { x: ref(inIds[0]), y: ref(inIds[1]) };
    } else if (n.kind === 'add') {
      op = 'tadd';
      args = { x: ref(inIds[0]), y: ref(inIds[1]) };
    } else if (n.kind === 'cast') {
      op = 'tcast';
      args = { x: ref(inIds[0]), to: n.dtype };
    } else {
      throw new Error(`pont: ${n.kind}/${n.dtype} non distribuable`);
    }
    const deps = new Set();
    for (const d of n.deps) {
      const rd = resolve(d);
      if (byId.get(rd).kind !== 'input') deps.add(rd);
    }
    fragments.push({
      v: 1, id: n.id, op, args, deps: [...deps],
      timeoutMs: n.timeoutMs || 8000, expiryMs: 60000,
      validation: { strategy: 'single', redundancy: 1 },
    });
  }
  return { v: 1, merge: 'last', fragments };
}

async function distribute(compute, graph, inputs, { jobId = null } = {}) {
  const dag = fusionToDag(graph, inputs);
  const job = await compute.submitDag(dag, { jobId });
  return { dag, job };
}

module.exports = { fusionToDag, distribute, tensorOf };

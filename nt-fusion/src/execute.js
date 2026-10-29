'use strict';

/**
 * NT-FUSION — exécution réelle d'un graphe typé sur tenseurs JS.
 * - Résout les $node depuis les valeurs déjà calculées.
 * - input : fromArray2D(values, dtype du nœud).
 * - cast : quantize (→int8) ou dequantize/arrondi (→fp32/fp64).
 * - matmul/add : tenseurs réels (nt-compat).
 * - retryMax : ré-exécutions sur erreur (panne injectable via hooks).
 * - Mesures réelles par nœud : ms, octets sortie, transferts simulés
 *   (0 si même worker, taille si changement — le fil réel est prouvé
 *   par §5/NT-Flux, pas re-mesuré ici).
 * Retour : { values:Map, metrics:{nodes:{id:{ms,bytes,worker,attempts}}, totalMs} }.
 */

const T = require('../../nt-compat/src/tensors');
const { validateGraph, topoOrder, inferShapes } = require('./graph');

function resolveInputs(decl, values) {
  const out = {};
  for (const [k, v] of Object.entries(decl)) {
    if (v && typeof v === 'object' && typeof v.$node === 'string') {
      const id = v.$node.split('.')[0];
      if (!values.has(id)) throw new Error(`exécution: valeur manquante ${id}`);
      out[k] = values.get(id);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function castTo(t, dtype) {
  if (t.dtype === dtype) return t;
  if (dtype === 'int8') {
    const f = t.dtype === 'int8acc' ? { dtype: 'fp32', shape: t.shape, data: Float32Array.from(T.toArray2D(t).flat()) } : t;
    return T.quantize(f.dtype === 'fp32' || f.dtype === 'fp64' ? f : T.dequantize(f));
  }
  // → fp32/fp64 : déquantifie puis convertit (arrondi réel du format).
  const f = t.dtype === 'int8' ? T.dequantize(t)
    : t.dtype === 'int8acc' ? { dtype: 'fp32', shape: t.shape, data: Float32Array.from(T.toArray2D(t).flat()) }
    : t;
  if (dtype === 'fp32') {
    const m = new Float32Array(f.data.length);
    for (let i = 0; i < m.length; i++) m[i] = f.data[i];
    return { dtype: 'fp32', shape: [...f.shape], data: m };
  }
  const m = new Float64Array(f.data.length);
  for (let i = 0; i < m.length; i++) m[i] = f.data[i];
  return { dtype: 'fp64', shape: [...f.shape], data: m };
}

/**
 * Exécute le graphe. plan = { assignments:{nodeId:workerId} } optionnel
 * (sinon worker unique 'local'). hooks = { onNode(id, attempt) } pour
 * injecter une panne en test (lève ⇒ retry/échec).
 */
async function executeGraph(g, { plan = null, hooks = {} } = {}) {
  validateGraph(g);
  inferShapes(g); // cohérence des shapes avant tout calcul
  const values = new Map();
  const metrics = { nodes: {}, totalMs: 0 };
  const t0 = process.hrtime.bigint();
  const workerOf = (id) => (plan && plan.assignments && plan.assignments[id]) || 'local';
  for (const n of topoOrder(g)) {
    const timeoutMs = n.timeoutMs || 30000;
    const retryMax = n.retryMax || 0;
    let lastErr = null;
    let attempts = 0;
    const mt0 = process.hrtime.bigint();
    for (let a = 0; a <= retryMax; a++) {
      attempts = a + 1;
      try {
        if (hooks.onNode) await hooks.onNode(n.id, attempts);
        values.set(n.id, runNode(n, values));
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
      if (Number(process.hrtime.bigint() - mt0) / 1e6 > timeoutMs) {
        lastErr = new Error(`exécution: timeout ${n.id} (${timeoutMs} ms)`);
        break;
      }
    }
    const ms = Number(process.hrtime.bigint() - mt0) / 1e6;
    if (lastErr) {
      metrics.totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
      const err = new Error(`exécution: nœud ${n.id} en échec après ${attempts} tentative(s) : ${lastErr.message}`);
      err.nodeId = n.id;
      err.metrics = metrics;
      throw err;
    }
    const v = values.get(n.id);
    metrics.nodes[n.id] = { ms, bytes: T.byteSize(v), worker: workerOf(n.id), attempts };
  }
  metrics.totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
  return { values, metrics };
}

function runNode(n, values) {
  if (n.kind === 'input') return T.fromArray2D(n.params.values, n.dtype);
  const ins = resolveInputs(n.in, values);
  const keys = Object.keys(ins);
  if (n.kind === 'cast') return castTo(ins[keys[0]], n.dtype);
  // Chaîne int8 : l'accumulateur Int32 du matmul précédent est
  // re-quantifié explicitement (documenté, erreur bornée testée).
  const norm = (t) => (n.dtype === 'int8' && t.dtype === 'int8acc' ? castTo(t, 'int8') : t);
  const a = ensureDtype(norm(ins[keys[0]]), n, 'gauche');
  const b = ensureDtype(norm(ins[keys[1]]), n, 'droite');
  if (n.kind === 'matmul') return T.matmul(a, b);
  if (n.kind === 'add') return T.add(a, b);
  throw new Error(`exécution: kind inconnu ${n.kind}`);
}

/** Garde d'exécution : le dtype réel doit matcher (défense en profondeur). */
function ensureDtype(t, n, side) {
  const want = n.dtype;
  const got = t.dtype === 'int8acc' ? 'int8acc' : t.dtype;
  if (got !== want && !(want === 'int8' && got === 'int8acc')) {
    throw new Error(`exécution: ${n.id} attend ${want}, reçoit ${got} (${side})`);
  }
  return t;
}

module.exports = { executeGraph, castTo };

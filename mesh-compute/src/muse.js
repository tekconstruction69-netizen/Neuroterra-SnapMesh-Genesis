'use strict';

/**
 * Orchestrateur Muse §6 — contrats `docs/MUSE_CONTRACTS.md`.
 *
 * Principe D3 : Muse (ou l'heuristique) PROPOSE, l'arbitre déterministe
 * DISPOSE. Toute proposition est validée avant usage ; tout refus bascule
 * sur `round-robin` avec journalisation de la proposition d'origine.
 *
 * - `heuristicPropose` : secours synchrone, déterministe, sans réseau.
 * - `musePropose` : adaptateur d'appel distant (fetch injecté, clé et URL
 *   par environnement/options, jamais dans le dépôt) ; le moindre échec
 *   (config, budget, timeout, JSON, arbitre) rend le repli heuristique.
 * - `validateProposal` : arbitre, pur et synchrone.
 * Aucune allégation de performance : O5 reste une hypothèse à mesurer (§10).
 */

const MUSE_V = 1;
const DEFAULT_BUDGETS = { maxCalls: 10, timeoutMs: 5000 };

/** Construit l'entrée v1 du contrat depuis candidats + file + historique. */
function buildPlacementInput({ nodes, queue, history, budgets }) {
  return {
    v: MUSE_V,
    at: new Date().toISOString(),
    nodes: (nodes || []).map((n) => ({
      id: n.id,
      name: n.name || String(n.id).slice(0, 12),
      cpus: n.cpus || 1,
      freeMem: n.memFreeBytes ?? n.freeMem ?? null,
      load: n.load || 0,
      state: n.state || 'connected',
      lastSeenAgoMs: n.lastSeenAgoMs ?? 0,
    })),
    queue: (queue || []).map((t) => ({
      taskId: t.taskId || t.id,
      op: t.op,
      args: t.args || {},
      redundancy: t.redundancy || 1,
      timeoutMs: t.timeoutMs || 8000,
      state: t.state || 'pending',
    })),
    history: history || [],
    budgets: { ...DEFAULT_BUDGETS, ...(budgets || {}) },
  };
}

/**
 * Arbitre déterministe (contrat §3) : vérifie version, tâches connues,
 * exécutants connectés, redondance 1..5, confiance ≥ 0,5, explication,
 * et budget d'appels pour le provider distant.
 */
function validateProposal(prop, { taskIds, connectedIds, redundancy = null, provider = 'heuristic', callsUsed = 0, budgets = DEFAULT_BUDGETS } = {}) {
  const no = (reason) => ({ ok: false, reason, fallback: 'round-robin' });
  if (!prop || typeof prop !== 'object') return no('proposition vide');
  if (prop.v !== MUSE_V) return no(`version attendue ${MUSE_V}`);
  if (!Array.isArray(prop.assignments) || !prop.assignments.length) return no('assignments vide');
  if (typeof prop.explanation !== 'string' || !prop.explanation.trim()) return no('explication manquante');
  if (typeof prop.confidence !== 'number' || prop.confidence < 0.5 || prop.confidence > 1) {
    return no('confiance hors [0.5, 1]');
  }
  for (const a of prop.assignments) {
    if (!a || typeof a.taskId !== 'string' || (taskIds && !taskIds.has(a.taskId))) {
      return no(`tâche inconnue : ${a && a.taskId}`);
    }
    if (!Array.isArray(a.executors) || a.executors.length < 1 || a.executors.length > 5) {
      return no(`redondance hors 1..5 pour ${a.taskId}`);
    }
    for (const id of a.executors) {
      if (!connectedIds || !connectedIds.has(id)) return no(`exécutant inconnu ou non connecté : ${id}`);
    }
    if (redundancy !== null && redundancy !== undefined && a.executors.length !== redundancy) {
      return no(`redondance ${a.executors.length} ≠ demandée ${redundancy} pour ${a.taskId}`);
    }
  }
  if (provider === 'muse' && callsUsed >= (budgets.maxCalls ?? DEFAULT_BUDGETS.maxCalls)) {
    return no('budget-appels épuisé');
  }
  return { ok: true };
}

/** Secours déterministe : capacité décroissante, confiance 0,8/0,6. */
function heuristicPropose(input, { redundancy = 1 } = {}) {
  const r = Math.min(5, Math.max(1, redundancy));
  const sorted = (input.nodes || []).slice().sort(
    (a, b) => b.cpus / (1 + (b.load || 0)) - a.cpus / (1 + (a.load || 0)) || (a.id < b.id ? -1 : 1)
  );
  const chosen = sorted.slice(0, Math.min(r, sorted.length)).map((n) => n.id);
  const detail = sorted.slice(0, Math.min(r, sorted.length)).map((n) => `${n.id.slice(0, 8)}:${n.cpus}cpu/ch${n.load || 0}`).join('+');
  return {
    v: MUSE_V,
    provider: 'heuristic',
    assignments: (input.queue || []).map((t) => ({ taskId: t.taskId, executors: chosen })),
    explanation: `${detail || 'aucun'} ; redondance ${r}.`,
    confidence: sorted.length >= r ? 0.8 : 0.6,
    fallback: 'round-robin',
  };
}

/** Invite strict : le modèle ne répond que par le JSON du contrat §3. */
function buildPrompt(input) {
  return [
    'Tu es un ordonnanceur de calcul distribué. Réponds UNIQUEMENT par un objet JSON strict, sans texte autour :',
    '{"v":1,"assignments":[{"taskId":"...","executors":["id64",...]}],"explanation":"...","confidence":0.5-1,"fallback":"round-robin"}',
    'Règles : executors ⊆ ids des nodes connectés ; 1 à 5 exécutants par tâche ; confidence < 0,5 interdite.',
    `Entrée : ${JSON.stringify(input)}`,
  ].join('\n');
}

/** Extrait le premier objet JSON d'un texte (tolère le verbiage autour). */
function extractJson(text) {
  const i = text.indexOf('{');
  const j = text.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('parse: aucun objet JSON');
  return JSON.parse(text.slice(i, j + 1));
}

/**
 * Adaptateur distant : tente Muse, sinon repli heuristique SIGNALÉ.
 * Ne lève jamais ; `callsUsed` compte les appels réellement émis.
 */
async function musePropose(input, { fetchImpl = null, apiUrl = null, apiKey = null, model = 'muse', callsUsed = 0, budgets = DEFAULT_BUDGETS, redundancy = 1 } = {}) {
  const b = { ...DEFAULT_BUDGETS, ...(budgets || {}) };
  const fallback = (reason) => {
    const proposal = heuristicPropose(input, { redundancy });
    return { provider: 'heuristic', proposal, reason };
  };
  if (!fetchImpl || !apiUrl || !apiKey) {
    return fallback('muse-indisponible (fetch/URL/clé non configurés)');
  }
  if (callsUsed >= b.maxCalls) return fallback('budget-appels épuisé');
  // Course contre le délai : un transport qui ignore le signal d'annulation
  // ne doit jamais pendre l'ordonnanceur (le stub de test le prouve).
  const ctrl = new AbortController();
  let timer;
  const timeoutP = new Promise((_, rej) => {
    timer = setTimeout(() => {
      ctrl.abort();
      rej(new Error(`délai dépassé (${b.timeoutMs} ms)`));
    }, b.timeoutMs);
    if (timer.unref) timer.unref();
  });
  try {
    const res = await Promise.race([
      fetchImpl(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: buildPrompt(input) }],
          max_tokens: 1024,
          temperature: 0,
        }),
        signal: ctrl.signal,
      }),
      timeoutP,
    ]);
    if (!res || res.ok !== true) throw new Error(`http: ${(res && res.status) || 'sans-réponse'}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('parse: contenu textuel absent');
    const proposal = extractJson(content);
    proposal.provider = 'muse';
    const taskIds = new Set((input.queue || []).map((t) => t.taskId));
    const connectedIds = new Set((input.nodes || []).map((n) => n.id));
    const redOf = {};
    for (const t of input.queue || []) redOf[t.taskId] = t.redundancy || 1;
    // Chaque assignment doit porter exactement sa redondance demandée.
    for (const a of proposal.assignments || []) {
      const want = redOf[a && a.taskId];
      if (want !== undefined && (!Array.isArray(a.executors) || a.executors.length !== want)) {
        const fb = fallback(`arbitre: redondance ${a.executors?.length} ≠ demandée ${want} pour ${a.taskId}`);
        fb.refusedProposal = proposal;
        return fb;
      }
    }
    const verdict = validateProposal(proposal, { taskIds, connectedIds, provider: 'muse', callsUsed, budgets: b });
    if (!verdict.ok) {
      return { ...fallback(`arbitre: ${verdict.reason}`), refusedProposal: proposal };
    }
    return { provider: 'muse', proposal, reason: null };
  } catch (e) {
    const msg = String((e && e.message) || e);
    const reason = /abort|aborted|timeout/i.test(msg) ? `délai dépassé (${b.timeoutMs} ms)` : msg.slice(0, 200);
    return fallback(reason);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  MUSE_V, DEFAULT_BUDGETS, buildPlacementInput, validateProposal,
  heuristicPropose, musePropose, buildPrompt, extractJson,
};

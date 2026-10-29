'use strict';

/**
 * Contrat Muse NT-Flux : politique de compression/déduplication par fragment.
 * Muse PROPOSE une politique globale ; l'arbitre déterministe DISPOSE
 * (même pattern D3 que §6). Le codec final reste choisi localement par
 * `selectEncoding` (qui voit les octets) SOUS la politique validée.
 * Entrée v1 : caractéristiques du fragment, capacités codecs, réseau
 * mesuré, budgets, options supportées.
 */

const FLUX_V = 1;
const EFFORTS = ['eco', 'normal', 'performance'];

function buildFluxInput({ fragment, nodeCaps, net, budgets, options }) {
  return {
    v: FLUX_V,
    at: new Date().toISOString(),
    fragment: {
      sizeBytes: fragment.sizeBytes,
      dataType: fragment.dataType || 'inconnu', // texte|json|binaire|compressé
      entropyHint: fragment.entropyHint ?? null, // ratio échantillon si mesuré
      requiresExact: fragment.requiresExact !== false,
    },
    nodeCaps: {
      codecs: (nodeCaps && nodeCaps.codecs) || ['raw'],
      cpu: (nodeCaps && nodeCaps.cpu) || 'inconnu',
    },
    net: {
      rttMs: (net && net.rttMs) || 0,
      bytesPerSec: (net && net.bytesPerSec) || null,
    },
    budgets: {
      maxCompressMs: (budgets && budgets.maxCompressMs) || 500,
      maxDecompressedBytes: (budgets && budgets.maxDecompressedBytes) || 4 * 1024 * 1024,
    },
    options: {
      dedup: !!(options && options.dedup),
      effort: (options && options.effort) || 'normal',
    },
  };
}

/** Arbitre : effort connu, dedup booléen, budgets bornés, codecs supportés. */
function validateFluxPolicy(policy, { supportedCodecs = ['raw'], requiresExact = true } = {}) {
  const no = (reason) => ({ ok: false, reason });
  if (!policy || typeof policy !== 'object') return no('politique vide');
  if (policy.v !== FLUX_V) return no(`version attendue ${FLUX_V}`);
  if (!EFFORTS.includes(policy.effort)) return no(`effort inconnu : ${policy.effort}`);
  if (typeof policy.dedup !== 'boolean') return no('dedup booléen requis');
  if (!Number.isInteger(policy.maxCompressMs) || policy.maxCompressMs <= 0) return no('maxCompressMs entier > 0 requis');
  if (policy.codecs !== undefined) {
    if (!Array.isArray(policy.codecs) || !policy.codecs.length) return no('codecs non vide requis');
    for (const c of policy.codecs) {
      if (!supportedCodecs.includes(c)) return no(`codec non supporté : ${c}`);
    }
  }
  if (typeof policy.confidence !== 'number' || policy.confidence < 0.5 || policy.confidence > 1) {
    return no('confiance hors [0.5, 1]');
  }
  if (typeof policy.explanation !== 'string' || !policy.explanation.trim()) return no('explication manquante');
  if (requiresExact && policy.allowLossy === true) return no('avec-perte interdit (exactitude requise)');
  return { ok: true };
}

/**
 * Heuristique déterministe : petits fragments → eco (raw probable, CPU
 * épargné) ; gros + réseau lent → normal + dedup ; réseau inconnu →
 * normal sans dedup (pas de pari). Confiance 0,6/0,8 selon la marge.
 */
function heuristicFlux(input) {
  const size = input.fragment.sizeBytes || 0;
  const bps = input.net.bytesPerSec;
  const slowNet = bps !== null && bps < 1024 * 1024;
  let effort = 'normal';
  let dedup = false;
  let confidence = 0.6;
  let why;
  if (size < 1024) {
    effort = 'eco';
    why = 'fragment < 1 Ko : compression rarement rentable.';
  } else if (slowNet) {
    dedup = true;
    confidence = 0.8;
    why = 'réseau lent mesuré : chaque octet compte, dedup utile.';
  } else {
    why = 'cas général : min-coût local, sans pari dedup.';
  }
  return {
    v: FLUX_V,
    provider: 'heuristic',
    effort,
    dedup,
    maxCompressMs: input.budgets.maxCompressMs,
    codecs: ['raw', 'deflate', 'gzip', 'brotli'],
    allowLossy: false,
    confidence,
    explanation: `heuristique : ${why}`,
  };
}

/**
 * Adaptateur distant : tente Muse, sinon repli heuristique SIGNALÉ.
 * Ne lève jamais. Même discipline que §6 (budgets, timeout, JSON strict).
 */
async function museProposeFlux(input, { fetchImpl = null, apiUrl = null, apiKey = null, model = 'muse', callsUsed = 0, maxCalls = 10, timeoutMs = 5000 } = {}) {
  const fallback = (reason) => ({ provider: 'heuristic', policy: heuristicFlux(input), reason });
  if (!fetchImpl || !apiUrl || !apiKey) return fallback('muse-indisponible (fetch/URL/clé non configurés)');
  if (callsUsed >= maxCalls) return fallback('budget-appels épuisé');
  const ctrl = new AbortController();
  let timer;
  const timeoutP = new Promise((_, rej) => {
    timer = setTimeout(() => {
      ctrl.abort();
      rej(new Error(`délai dépassé (${timeoutMs} ms)`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });
  try {
    const prompt = [
      'Tu es un optimiseur de transferts. Réponds UNIQUEMENT par un objet JSON strict, sans texte autour :',
      '{"v":1,"effort":"eco|normal|performance","dedup":true,"maxCompressMs":500,"codecs":["raw","deflate"],"allowLossy":false,"confidence":0.5-1,"explanation":"..."}',
      `Entrée : ${JSON.stringify(input)}`,
    ].join('\n');
    const res = await Promise.race([
      fetchImpl(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 512, temperature: 0 }),
        signal: ctrl.signal,
      }),
      timeoutP,
    ]);
    if (!res || res.ok !== true) throw new Error(`http: ${(res && res.status) || 'sans-réponse'}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('parse: contenu textuel absent');
    const i = content.indexOf('{');
    const j = content.lastIndexOf('}');
    if (i < 0 || j <= i) throw new Error('parse: aucun objet JSON');
    const policy = JSON.parse(content.slice(i, j + 1));
    policy.provider = 'muse';
    const verdict = validateFluxPolicy(policy, { supportedCodecs: ['raw', 'deflate', 'gzip', 'brotli'], requiresExact: input.fragment.requiresExact });
    if (!verdict.ok) return { ...fallback(`arbitre: ${verdict.reason}`), refusedPolicy: policy };
    return { provider: 'muse', policy, reason: null };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return fallback(/abort|aborted|délai dépassé/i.test(msg) ? msg.slice(0, 200) : msg.slice(0, 200));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { FLUX_V, EFFORTS, buildFluxInput, validateFluxPolicy, heuristicFlux, museProposeFlux };

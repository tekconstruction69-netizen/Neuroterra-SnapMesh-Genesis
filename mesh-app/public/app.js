'use strict';
/* SnapMesh app : deux modes stricts, décidés par le jeton local uniquement.
   - Jeton local valide (injecté par mesh-app/server.js, boucle locale) :
     comportement local existant (START/STOP, modes, SSE + repli polling).
   - Sinon (placeholder "__GENESIS_TOKEN__", absent ou malformé) :
     démonstration statique explicite — contrôles désactivés, aucune
     donnée mesurée, zéro fetch/EventSource/polling vers /api.
   Le mode n'est jamais déduit du nom d'hôte. */

const ETATS = {
  STOPPED: 'arrêté', STARTING: 'démarrage', ACTIVE: 'actif',
  THERMAL_LIMIT: 'limitation thermique', SUSPENDED: 'suspendu', ERROR: 'erreur',
  ANALYZING: 'analyse en cours', READY: 'prêt', WAITING_FOR_PEERS: 'en attente de pairs (prêt)',
  WAITING_FOR_TASKS: 'en attente de tâches (prêt)', RUNNING: 'tâche en exécution',
  PAUSED_SAFETY: 'pause de protection', CONNECTION_LOST: 'connexion perdue',
};

const $ = (id) => document.getElementById(id);
const toggle = $('toggle');

// Jeton local : format émis par src/guards.js (48 hex). Le placeholder
// servi tel quel sur l'hébergement statique ne correspond pas à ce format.
const TOKEN = (typeof window.__GENESIS_TOKEN__ === 'string' && /^[0-9a-f]{48}$/.test(window.__GENESIS_TOKEN__))
  ? window.__GENESIS_TOKEN__
  : null;
const LOCAL = TOKEN !== null;

function controls() {
  return [toggle, $('consent'), $('job-run'), $('job-preset'), $('job-params'),
    ...document.querySelectorAll('.modes button')].filter(Boolean);
}

function setControlsEnabled(enabled) {
  for (const el of controls()) el.disabled = !enabled;
}

function applyDemoMode() {
  setControlsEnabled(false);
  const banner = $('mode-banner');
  if (banner) banner.classList.remove('local');
  if ($('mode-title')) $('mode-title').textContent = 'Démonstration statique';
  if ($('mode-text')) $('mode-text').textContent = 'Cette page publique est une démonstration statique : aucune passerelle de production, aucun appareil connecté et aucun calcul en direct. Les contrôles sont désactivés et aucune donnée en direct n\'est affichée.';
  if ($('state')) $('state').textContent = 'État : démonstration statique';
  if ($('reason')) $('reason').textContent = 'Aucun serveur local authentifié détecté : contrôles désactivés.';
}

function applyLocalMode() {
  setControlsEnabled(true);
  const banner = $('mode-banner');
  if (banner) banner.classList.add('local');
  if ($('mode-title')) $('mode-title').textContent = 'Mode local authentifié';
  if ($('mode-text')) $('mode-text').textContent = 'Serveur de boucle locale authentifié par jeton local : les contrôles ci-dessous agissent sur votre machine uniquement. STOP reste prioritaire sur tout ordonnanceur.';
  if ($('state')) $('state').textContent = 'État : connexion au serveur local…';
}

async function call(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'X-Genesis-Token': TOKEN } : {}) },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

async function refresh() {
  try {
    const r = await fetch('/api/state');
    render(await r.json());
  } catch {
    $('state').textContent = 'État : injoignable (serveur local coupé ?)';
  }
}

function render(s) {
  const active = s.safety.state === 'ACTIVE' || s.safety.state === 'THERMAL_LIMIT';
  const ws = s.safety.workerState || s.safety.state;
  $('state').textContent = 'État : ' + (ETATS[ws] || ws) + (ws === 'WAITING_FOR_PEERS' ? ' — worker disponible, aucun pair requis pour démarrer' : '');
  $('reason').textContent = s.safety.reason || '';
  toggle.textContent = active ? 'ARRÊTER' : 'DÉMARRER';
  toggle.classList.toggle('stop', active);
  document.querySelectorAll('.modes button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === s.safety.mode);
  });
  $('r-cpu').textContent = (s.safety.measuredCpu * 100).toFixed(1) + ' % (objectif ' + Math.round(s.safety.targets.cpuTarget * 100) + ' %)';
  const go = s.telemetry.totalMem / 2 ** 30;
  const free = s.telemetry.freeMem / 2 ** 30;
  $('r-mem').textContent = free.toFixed(1) + ' / ' + go.toFixed(1) + ' Go libres';
  $('r-tasks').textContent = String(s.safety.activeTasks);
  $('r-th').textContent = s.safety.thermal + (s.safety.thermal === 'NORMAL' ? ' (aucune sonde fiable : politique conservatrice)' : '');
  const peers = s.mesh.peers || [];
  $('n-count').textContent = String(peers.length);
  $('peers').innerHTML = peers.length
    ? peers.map((p) => `<li><b>${esc(p.name)}</b> ${esc(p.short)} — ${esc(p.state)}</li>`).join('')
    : '<li>Aucun pour l\'instant.</li>';
  const res = s.results || [];
  $('results').innerHTML = res.length
    ? res.map((r) => `<li><b>${esc(r.op)}</b> ${esc(r.outcome)} — ${r.agreeing} accord(s), ${r.dissenting} dissident(s)</li>`).join('')
    : '<li>Aucun pour l\'instant.</li>';
  // §9 : profil NT-ID (id cryptographique tronqué à l'affichage).
  if (s.profile) {
    $('p-id').textContent = String(s.profile.ntId).slice(0, 24) + '…';
    $('p-id').title = s.profile.ntId;
    $('p-name').textContent = s.profile.name || '';
    $('p-brake').textContent = s.profile.brake && s.profile.brake.go ? 'oui' : 'non (' + ((s.profile.brake && s.profile.brake.reason) || '?') + ')';
  }
  // §9 : capacités NT-CAP telles que publiées (jamais inventées ici).
  if (s.caps) {
    const c = s.caps.self || {};
    const cpu = c.cpu || {};
    const ram = c.ram || {};
    $('caps-self').textContent = `CPU ${esc(cpu.arch || '?')} ${cpu.threads || '?'} threads · RAM libre ${ram.free != null ? (ram.free / 2 ** 30).toFixed(1) + ' Go' : '?'} · limites ${c.limits ? 'oui' : 'non'}`;
    const peers = s.caps.peers || [];
    $('caps-peers').innerHTML = peers.length
      ? peers.map((p) => `<li><b>${esc(p.name)}</b> ${esc(p.short)} — CPU ${((p.caps || {}).cpu || {}).threads || '?'} threads · session ${p.sessionVerified ? 'vérifiée' : 'non vérifiée'}</li>`).join('')
      : '<li>Aucun pour l\'instant.</li>';
  }
  // §9 : graphe temps réel (positions déterministes en cercle, liens = sockets).
  drawGraph(s.graph);
  // §9 : derniers jobs (valeur + empreinte finale du faisceau).
  if ((s.jobs || []).length) renderJobs(s.jobs);
}

function renderJobs(jobs) {
  const j = jobs[0];
  const box = $('job-out');
  box.dataset.id = String(j.jobId);
  const v = j.verification;
  box.innerHTML = `<p><b>${esc(j.outcome)}</b> — valeur : <code>${esc(JSON.stringify(j.value))}</code></p>`
    + (v ? `<p>Empreinte finale : <code>${esc(v.finalHash)}</code> (${v.fragments.length} fragment(s), merge ${esc(v.merge)})</p>` : '')
    + (j.error ? `<p>Erreur : ${esc(j.error)}</p>` : '');
}

function drawGraph(g) {
  const svg = $('graph');
  if (!svg || !g || !g.nodes || !g.nodes.length) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const W = 300;
  const H = 150;
  const n = g.nodes.length;
  const pos = {};
  g.nodes.forEach((nd, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, n);
    pos[nd.id] = [W / 2 + (W / 2 - 30) * Math.cos(a), H / 2 + (H / 2 - 25) * Math.sin(a)];
  });
  const ns = 'http://www.w3.org/2000/svg';
  for (const l of g.links || []) {
    if (!pos[l.from] || !pos[l.to]) continue;
    const e = document.createElementNS(ns, 'line');
    e.setAttribute('x1', pos[l.from][0]); e.setAttribute('y1', pos[l.from][1]);
    e.setAttribute('x2', pos[l.to][0]); e.setAttribute('y2', pos[l.to][1]);
    e.setAttribute('stroke', '#4caf6d');
    svg.appendChild(e);
  }
  for (const nd of g.nodes) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', pos[nd.id][0]); c.setAttribute('cy', pos[nd.id][1]);
    c.setAttribute('r', nd.self ? 10 : 7);
    c.setAttribute('fill', nd.self ? '#1d4d2b' : '#4caf6d');
    const t = document.createElementNS(ns, 'title');
    t.textContent = (nd.name || '') + ' ' + String(nd.id).slice(0, 12);
    c.appendChild(t);
    svg.appendChild(c);
  }
}

function esc(x) {
  return String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

toggle.addEventListener('click', async () => {
  if (!LOCAL) { applyDemoMode(); return; }
  toggle.disabled = true;
  try {
    const st = await (await fetch('/api/state')).json();
    const active = st.safety.state === 'ACTIVE' || st.safety.state === 'THERMAL_LIMIT';
    if (active) {
      await call('/api/stop', { reason: 'arrêt demandé (UI)' });
    } else {
      if (!$('consent').checked) {
        $('reason').textContent = 'Cochez le consentement pour démarrer.';
      } else {
        await call('/api/start', { consent: true });
      }
    }
    await refresh();
  } catch {
    $('reason').textContent = 'Commande locale échouée : serveur injoignable ou réponse invalide.';
  } finally {
    toggle.disabled = false;
  }
});

const diagBtn = $('job-diag');
if (diagBtn) {
  diagBtn.addEventListener('click', async () => {
    if (!LOCAL) { applyDemoMode(); return; }
    const st = $('job-status');
    st.textContent = 'Microcalcul de diagnostic en cours (borné, à votre demande)…';
    try {
      const r = await call('/api/diag', {});
      const mb = r.microbench && r.microbench.valeur ? `${r.microbench.valeur.gflops} Gflops en ${r.microbench.valeur.matmul48Fp32Ms} ms` : 'non mesuré';
      st.textContent = `Diagnostic local réel : ${mb} — état ${ETATS[r.workerState] || r.workerState}. Aucune contribution simulée.`;
    } catch {
      st.textContent = 'Serveur injoignable.';
    }
  });
}

const jobRun = $('job-run');
if (jobRun) {
  jobRun.addEventListener('click', async () => {
    if (!LOCAL) { applyDemoMode(); return; }
    const st = $('job-status');
    const out = $('job-out');
    st.textContent = 'Exécution en cours…';
    out.innerHTML = '—';
    let params;
    try {
      params = JSON.parse($('job-params').value);
    } catch {
      st.textContent = 'Paramètres JSON invalides.';
      return;
    }
    try {
      const r = await fetch('/api/job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'X-Genesis-Token': TOKEN } : {}) },
        body: JSON.stringify({ preset: $('job-preset').value, params }),
      });
      const job = await r.json();
      st.textContent = job.outcome === 'done' ? 'Terminé et vérifié.' : `Échec : ${job.error || 'voir détails'}`;
      await refresh();
    } catch {
      st.textContent = 'Serveur injoignable.';
    }
  });
}

document.querySelectorAll('.modes button').forEach((b) => {
  b.addEventListener('click', async () => {
    if (!LOCAL) { applyDemoMode(); return; }
    try {
      await call('/api/mode', { mode: b.dataset.mode });
      await refresh();
    } catch {
      $('reason').textContent = 'Commande locale échouée : serveur injoignable ou réponse invalide.';
    }
  });
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/* --- Refonte : navigation, analyse réelle, réglages persistants --- */
const SETTINGS_KEY = 'genesis-settings-v1';
const settings = (() => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
})();
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* stockage refusé : session seulement */ }
}

document.querySelectorAll('[data-nav]').forEach((b) => {
  b.addEventListener('click', () => {
    const name = b.dataset.nav;
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${name}`));
    document.querySelectorAll('.tabbar button').forEach((x) => x.classList.toggle('on', x.dataset.nav === name));
    window.scrollTo(0, 0);
  });
});
const notifBtn = $('btn-notifs');
if (notifBtn) notifBtn.addEventListener('click', () => {
  const r = $('reason');
  if (r) r.textContent = 'Notifications : aucun événement. Les états réels du worker apparaissent ici en mode local.';
});

function setCard(cardId, valId, tagId, value, tag) {
  const card = $(cardId);
  if (card) card.classList.remove('locked');
  if ($(valId)) $(valId).textContent = value;
  if ($(tagId)) $(tagId).textContent = tag;
}

let batteryRef = null;
async function analyzeDevice() {
  const status = $('analyze-status');
  if (!$('an-consent') || !$('an-consent').checked) {
    status.textContent = 'Consentement requis : cochez l\u2019autorisation d\u2019analyse.';
    return;
  }
  status.textContent = 'Analyse locale en cours…';
  const cores = navigator.hardwareConcurrency || null;
  setCard('card-cpu', 'a-cpu', 't-cpu', cores ? `${cores} cœurs logiques` : 'Non disponible', cores ? 'Détecté (navigateur)' : 'Non disponible');
  let gpuTxt = 'Non disponible';
  let gpuTag = 'Non disponible';
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) { gpuTxt = 'WebGPU présent (adaptateur répond)'; gpuTag = 'Détecté (WebGPU)'; }
    }
  } catch { /* WebGPU refusé : Non disponible conservé */ }
  const mem = navigator.deviceMemory ? ` · RAM ≈ ${navigator.deviceMemory} Go (navigateur)` : '';
  setCard('card-gpu', 'a-gpu', 't-gpu', gpuTxt + mem, gpuTag);
  const conn = navigator.connection || {};
  let netTxt = conn.effectiveType ? `Type ${conn.effectiveType}` : 'Non disponible';
  try {
    const t0 = performance.now();
    await fetch('/styles.css', { cache: 'no-store' });
    const ms = Math.max(1, performance.now() - t0);
    netTxt += ` · ressource locale en ${ms.toFixed(0)} ms`;
  } catch { /* ressource non joignable : type seul */ }
  setCard('card-net', 'a-net', 't-net', netTxt, conn.effectiveType ? 'Estimé (navigateur)' : 'Non disponible');
  let battTxt = 'Non disponible (thermique non exposée)';
  let battTag = 'Non disponible';
  try {
    if (navigator.getBattery) {
      batteryRef = await navigator.getBattery();
      battTxt = `Batterie ${Math.round(batteryRef.level * 100)} %${batteryRef.charging ? ' (en charge)' : ''} · température non disponible`;
      battTag = 'Mesuré (batterie)';
    }
  } catch { /* API batterie refusée */ }
  setCard('card-batt', 'a-batt', 't-batt', battTxt, battTag);
  if (LOCAL) {
    try {
      const s = await (await fetch('/api/state')).json();
      const c = (s.caps && s.caps.self) || {};
      const cpu = c.cpu || {};
      if (cpu.threads) setCard('card-cpu', 'a-cpu', 't-cpu', `${cpu.threads} threads · ${cpu.arch || ''}`, 'Mesuré (worker local)');
      const hw = s.hardware || {};
      const val = (f) => (hw[f] && hw[f].valeur !== null && hw[f].valeur !== undefined ? hw[f].valeur : null);
      if (val('cpuModele')) setCard('card-cpu', 'a-cpu', 't-cpu', `${val('cpuModele')} · ${val('cpuLogiques') || cpu.threads || '?'} logiques${val('cpuPhysiques') ? ` · ${val('cpuPhysiques')} physiques` : ''}${hw.microbench && hw.microbench.valeur ? ` · microbench ${hw.microbench.valeur.gflops} Gflops` : ''}`, 'Mesuré (système local)');
      if (val('gpuModele')) setCard('card-gpu', 'a-gpu', 't-gpu', `${val('gpuModele')}${val('vramGo') ? ` · VRAM déclarée ${val('vramGo')} Go` : ''}`, 'Détecté (système local)');
      if (hw.batterie && hw.batterie.valeur) setCard('card-batt', 'a-batt', 't-batt', `Batterie ${hw.batterie.valeur.pct} % · température non disponible`, 'Mesuré (système local)');
      if ($('set-ntid') && s.profile) $('set-ntid').textContent = String(s.profile.ntId).slice(0, 24) + '…';
      if ($('set-worker')) $('set-worker').textContent = s.safety ? (ETATS[s.safety.state] || s.safety.state) : 'Connecté';
    } catch {
      status.textContent = 'Analyse navigateur terminée ; worker local injoignable.';
      return;
    }
  }
  status.textContent = LOCAL
    ? 'Analyse terminée (navigateur + worker local). Vous pouvez DÉMARRER.'
    : 'Analyse terminée (navigateur seul). Aucun worker connecté : START reste désactivé.';
  // Après succès, l'analyse redevient une action secondaire de relance.
  if (analyzeBtn) {
    analyzeBtn.classList.add('secondary');
    const label = analyzeBtn.querySelector('span:nth-child(2)');
    if (label) label.textContent = 'Relancer l\u2019analyse de votre appareil';
  }
}

const analyzeBtn = $('analyze-btn');
if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeDevice);

// Temps de contribution : accumulé seulement quand l'état affiché est actif.
let contribSec = Number(settings.contribSec || 0);
setInterval(() => {
  const st = $('state');
  const running = !!(st && /actif|limitation|exécution/.test(st.textContent));
  document.body.classList.toggle('contributing', running);
  if (running) {
    contribSec++;
    settings.contribSec = contribSec;
    if (contribSec % 5 === 0) saveSettings();
    const el = $('r-time');
    if (el) el.textContent = contribSec >= 60 ? `${Math.floor(contribSec / 60)} min ${contribSec % 60} s` : `${contribSec} s`;
  }
}, 1000);

// Réglages persistants + garde batterie réelle (si API disponible).
function bindSettings() {
  const name = $('set-name');
  if (!name) return;
  name.value = settings.deviceName || '';
  name.addEventListener('change', () => { settings.deviceName = name.value; saveSettings(); });
  const batt = $('set-batt');
  batt.value = String(settings.battStop ?? 25);
  $('batt-val').textContent = `${batt.value} %`;
  batt.addEventListener('input', () => {
    settings.battStop = Number(batt.value);
    $('batt-val').textContent = `${batt.value} %`;
    saveSettings();
  });
  const chargeOnly = $('set-chargeonly');
  chargeOnly.checked = !!settings.chargeOnly;
  chargeOnly.addEventListener('change', () => { settings.chargeOnly = chargeOnly.checked; saveSettings(); });
  const gpu = $('set-gpu');
  gpu.checked = !!settings.gpuAllowed;
  gpu.addEventListener('change', () => { settings.gpuAllowed = gpu.checked; saveSettings(); });
  const disc = $('set-discovery');
  disc.checked = settings.discovery !== false;
  disc.addEventListener('change', () => { settings.discovery = disc.checked; saveSettings(); });
  const consentSet = $('set-consent');
  consentSet.checked = !!settings.consent;
  consentSet.addEventListener('change', async () => {
    settings.consent = consentSet.checked;
    saveSettings();
    const mainConsent = $('consent');
    if (mainConsent) mainConsent.checked = consentSet.checked;
    if (!consentSet.checked && LOCAL) {
      try { await call('/api/stop', { reason: 'consentement révoqué (réglages)' }); await refresh(); } catch { /* état conservé */ }
    }
  });
  const modeSel = $('set-mode');
  modeSel.value = settings.mode || 'balanced';
  modeSel.addEventListener('change', async () => {
    settings.mode = modeSel.value;
    saveSettings();
    if (LOCAL) {
      try { await call('/api/mode', { mode: modeSel.value }); await refresh(); } catch { /* état conservé */ }
    }
  });
  // Garde batterie : appliquée uniquement avec mesure réelle disponible.
  setInterval(async () => {
    if (!batteryRef) {
      try { if (navigator.getBattery) batteryRef = await navigator.getBattery(); } catch { /* toujours indisponible */ }
      if (!batteryRef) return;
    }
    const seuil = Number(settings.battStop ?? 25);
    const low = batteryRef.level * 100 < seuil && !batteryRef.charging;
    const chargeBlock = settings.chargeOnly && !batteryRef.charging;
    if ((low || chargeBlock) && LOCAL) {
      const st = await (await fetch('/api/state')).json().catch(() => null);
      if (st && (st.safety.state === 'ACTIVE' || st.safety.state === 'THERMAL_LIMIT')) {
        await call('/api/stop', { reason: low ? 'batterie faible (garde réglages)' : 'charge requise (réglages)' });
        await refresh();
        const note = $('batt-note');
        if (note) note.textContent = 'Garde batterie appliquée : contribution arrêtée (mesure réelle).';
      }
    }
  }, 30000);
}
bindSettings();

/* --- Adaptateurs de capacités (statuts réels, jamais simulés) --- */
const IOSAdapter = {
  isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent || ''); },
  standalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; },
  limits() { return 'PWA iOS : premier plan uniquement, aucun calcul permanent en arrière-plan, Wi-Fi Direct et Web Bluetooth non annoncés'; },
};
const AndroidAdapter = {
  isAndroid() { return /android/i.test(navigator.userAgent || ''); },
  limits() { return 'PWA Android : capacités selon le navigateur, aucun accès natif supposé'; },
};
const techBtn = $('btn-tech');
if (techBtn) techBtn.addEventListener('click', () => {
  const panel = $('tech-panel');
  if (panel) panel.hidden = !panel.hidden;
});
const emergencyBtn = $('btn-emergency-stop');
if (emergencyBtn) emergencyBtn.addEventListener('click', async () => {
  const note = $('emergency-note');
  if (!LOCAL) { if (note) note.textContent = 'Aucun worker connecté : rien à arrêter (aucun arrêt simulé).'; return; }
  try {
    await call('/api/stop', { reason: 'STOP d\u2019urgence (Mon appareil)' });
    await refresh();
    if (note) note.textContent = 'STOP d\u2019urgence appliqué par le worker local.';
  } catch { if (note) note.textContent = 'STOP demandé mais worker injoignable : vérifiez l\u2019état dans Diagnostics avancés.'; }
});

const BrowserAdapter = {
  wifi() { return navigator.onLine ? 'Actif (navigateur en ligne)' : 'Désactivé (navigateur hors ligne)'; },
  bluetoothSupported() { return !!navigator.bluetooth; },
  wifiDirect() { return 'Non compatible (aucune API navigateur)'; },
  os() { return navigator.platform || 'Non disponible'; },
};
const WindowsWorkerAdapter = {
  async caps() {
    if (!LOCAL) return null;
    try { return await (await fetch('/api/state')).json(); } catch { return null; }
  },
};
const NetworkTransportAdapter = {
  async gateway() {
    try {
      const r = await fetch('/.netlify/functions/gateway');
      if (!r.ok) return 'Erreur (passerelle injoignable)';
      const j = await r.json();
      return j.nodesLive === null ? 'Disponible (aucun nœud réel branché)' : 'Actif';
    } catch { return 'Non disponible hors hébergement passerelle'; }
  },
};

async function refreshDevice() {
  if ($('dev-os')) $('dev-os').textContent = BrowserAdapter.os()
    + (IOSAdapter.isIOS() ? ` · iPhone/iPad (${IOSAdapter.standalone() ? 'PWA installée' : 'Safari'}) — ${IOSAdapter.limits()}`
      : AndroidAdapter.isAndroid() ? ` · Android — ${AndroidAdapter.limits()}` : '');
  if ($('dev-name')) $('dev-name').textContent = settings.deviceName || 'Cet appareil';
  if ($('dev-cpu') && $('a-cpu')) $('dev-cpu').textContent = $('a-cpu').textContent;
  if ($('dev-gpu') && $('a-gpu')) $('dev-gpu').textContent = $('a-gpu').textContent;
  if ($('dev-ram')) $('dev-ram').textContent = navigator.deviceMemory ? `≈ ${navigator.deviceMemory} Go (navigateur, estimé)` : 'Non disponible via le navigateur';
  if ($('cx-wifi')) $('cx-wifi').textContent = BrowserAdapter.wifi();
  if ($('dev-net')) $('dev-net').textContent = BrowserAdapter.wifi();
  if ($('cx-bluetooth')) $('cx-bluetooth').textContent = BrowserAdapter.bluetoothSupported()
    ? 'Autorisation nécessaire (action explicite)' : 'Non compatible (Web Bluetooth absent)';
  if ($('cx-wifidirect')) $('cx-wifidirect').textContent = BrowserAdapter.wifiDirect();
  if ($('cx-gateway')) $('cx-gateway').textContent = await NetworkTransportAdapter.gateway();
  const s = await WindowsWorkerAdapter.caps();
  if (s) {
    if ($('dev-ntid') && s.profile) $('dev-ntid').textContent = String(s.profile.ntId).slice(0, 24) + '…';
    const hw = s.hardware || {};
    if (hw.cpuModele && hw.cpuModele.valeur && $('dev-cpu')) $('dev-cpu').textContent = `${hw.cpuModele.valeur} · ${hw.cpuLogiques.valeur} logiques`;
    if (hw.gpuModele && $('dev-gpu')) $('dev-gpu').textContent = hw.gpuModele.valeur || 'Non disponible (sonde système)';
    if (hw.ramTotaleGo && hw.ramTotaleGo.valeur && $('dev-ram')) $('dev-ram').textContent = `${hw.ramTotaleGo.valeur} Go au total · ${hw.ramLibreGo.valeur} Go libres (mesuré)`;
    if ($('dev-caps')) $('dev-caps').textContent = $('a-cpu') ? $('a-cpu').textContent : 'Worker local connecté';
    if ($('dev-contrib')) $('dev-contrib').textContent = ETATS[s.safety.workerState || s.safety.state] || s.safety.state;
    const peers = s.mesh.peers || [];
    if ($('dev-peers')) $('dev-peers').textContent = peers.length
      ? peers.map((p) => `${p.name} (${p.sessionVerified ? 'authentifié' : 'non vérifié'})`).join(', ')
      : 'Aucun pour l\u2019instant';
    if ($('cx-wifidirect')) {
      const transports = ((s.caps.self || {}).net || {}).transports || ['tcp-ip'];
      const wd = (s.hardware || {}).wifiDirect || {};
      if (transports.includes('wifi-direct')) $('cx-wifidirect').textContent = 'Actif (transport worker annoncé)';
      else if (wd.statut === 'détecté') $('cx-wifidirect').textContent = `Disponible (pilote) — ${wd.valeur} ; transport worker non implémenté`;
      else $('cx-wifidirect').textContent = 'Non compatible — Wi-Fi Direct non disponible sur cet appareil.';
    }
    if ($('cx-wifi')) $('cx-wifi').textContent = peers.length ? 'Actif (pairs connectés)' : 'Disponible (aucun pair, prêt)';
  }
}
refreshDevice();

const wdBtn = $('btn-wifidirect');
if (wdBtn) wdBtn.addEventListener('click', async () => {
  const out = $('discover-out');
  const s = await WindowsWorkerAdapter.caps();
  if (!s) { out.textContent = 'Wi-Fi Direct non disponible sur cet appareil (aucun worker local ; le navigateur ne propose pas cette API).'; return; }
  const transports = ((s.caps.self || {}).net || {}).transports || [];
  out.textContent = transports.includes('wifi-direct')
    ? 'Wi-Fi Direct annoncé par le worker : suivez l\u2019appairage système Windows.'
    : 'Wi-Fi Direct non disponible sur cet appareil (le worker n\u2019annonce que TCP/IP). Aucun réglage système n\u2019a été modifié.';
});
const btBtn = $('btn-bluetooth');
if (btBtn) btBtn.addEventListener('click', async () => {
  const out = $('discover-out');
  if (!navigator.bluetooth) {
    out.textContent = 'Bluetooth non compatible ici (Web Bluetooth absent, cas Safari iOS). Aucune connexion simulée.';
    if ($('cx-bluetooth')) $('cx-bluetooth').textContent = 'Non compatible';
    return;
  }
  try {
    const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
    if ($('cx-bluetooth')) $('cx-bluetooth').textContent = `Appareil sélectionné : ${dev.name || 'sans nom'} (découvert, pas encore authentifié NT)`;
    out.textContent = 'Appareil Bluetooth découvert par le sélecteur système. Appairage et authentification NT-ID restent requis avant tout statut Connecté.';
  } catch {
    out.textContent = 'Autorisation Bluetooth refusée ou sélection annulée : aucun appareil connecté.';
    if ($('cx-bluetooth')) $('cx-bluetooth').textContent = 'Autorisation nécessaire (refusée)';
  }
});
const discBtn = $('btn-discover');
if (discBtn) discBtn.addEventListener('click', async () => {
  const out = $('discover-out');
  out.textContent = 'Recherche sur les interfaces réellement disponibles…';
  await refreshDevice();
  const s = await WindowsWorkerAdapter.caps();
  if (!s) {
    out.textContent = 'Découverte réseau non disponible dans ce navigateur seul : ouvrez l\u2019application locale Windows pour rechercher des pairs authentifiés. Aucun appareil trouvé ni inventé.';
    return;
  }
  const peers = s.mesh.peers || [];
  if (!peers.length) {
    out.textContent = 'Interfaces vérifiées (Wi-Fi/IP local principal). Recherche terminée : aucun pair authentifié trouvé. Le worker reste prêt (ce n\u2019est pas une panne). Appairage volontaire : démarrez le worker du second appareil vers ce coordinateur (procédure Mon appareil).';
    return;
  }
  out.innerHTML = `Interfaces vérifiées. ${peers.length} pair(s) réellement trouvé(s) :<br>`
    + peers.map((p) => `${esc(p.name)} — identité NT ${p.sessionVerified ? 'vérifiée (signature de session)' : 'NON vérifiée'} — état ${esc(p.state)}`).join('<br>')
    + '<br>Seuls les pairs à session vérifiée sont enregistrés comme authentifiés.';
});

if (!LOCAL) {
  applyDemoMode();
} else {
  applyLocalMode();
  try {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try { render(JSON.parse(e.data)); } catch { /* trame ignorée, état conservé */ }
    };
    es.onerror = () => { es.close(); setInterval(refresh, 2000); };
  } catch {
    setInterval(refresh, 2000);
  }
  refresh();
}

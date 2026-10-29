'use strict';
/* SnapMesh app : START/STOP, modes, état temps réel (SSE + repli polling). */

const ETATS = {
  STOPPED: 'arrêté', STARTING: 'démarrage', ACTIVE: 'actif',
  THERMAL_LIMIT: 'limitation thermique', SUSPENDED: 'suspendu', ERROR: 'erreur',
};

const $ = (id) => document.getElementById(id);
const toggle = $('toggle');

const TOKEN = (window.__GENESIS_TOKEN__ && !window.__GENESIS_TOKEN__.includes('GENESIS_TOKEN'))
  ? window.__GENESIS_TOKEN__
  : null;

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
  $('state').textContent = 'État : ' + (ETATS[s.safety.state] || s.safety.state);
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
  } finally {
    toggle.disabled = false;
  }
});

const jobRun = $('job-run');
if (jobRun) {
  jobRun.addEventListener('click', async () => {
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
    await call('/api/mode', { mode: b.dataset.mode });
    await refresh();
  });
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

try {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => render(JSON.parse(e.data));
  es.onerror = () => { es.close(); setInterval(refresh, 2000); };
} catch {
  setInterval(refresh, 2000);
}
refresh();

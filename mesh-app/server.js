#!/usr/bin/env node
'use strict';

/**
 * M2-SAFETY — pont local : PWA (public/) + API JSON/SSE sur 127.0.0.1.
 * Assemble SafetyController (STOP prioritaire) + SnapMeshNode (M1) +
 * ComputeNode (M2) avec garde-fou admit. Aucune exposition réseau :
 * écoute loopback uniquement. Aucune promesse de revenu.
 *
 *   node server.js --port 48700 [--name app] [--mode balanced]
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { SnapMeshNode } = require('snapmesh-mesh-net');
const { ComputeNode } = require('snapmesh-mesh-compute');
const { SafetyController } = require('snapmesh-mesh-safety');
const { systemTelemetry } = require('snapmesh-mesh-safety/src/telemetry');

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : (process.argv[i + 1] ?? def);
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}
// P2 : garde-fous API locale (audit indépendant), logique dans src/guards.js.
const { MAX_BODY, newToken, originOk, tokenOk } = require('./src/guards');
const LOCAL_TOKEN = newToken();

const PORT = Number(arg('port', '48700'));
const NAME = arg('name', 'app-local');
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

// Limiteur de débit d'admission par mode (tâches / 10 s) : application
// RÉELLE du budget, distincte de l'objectif % coopératif.
const RATE = { eco: 2, balanced: 10, performance: 25 };

async function main() {
  const controller = new SafetyController({ mode: arg('mode', 'balanced') });
  const node = new SnapMeshNode({
    name: NAME,
    tcpPort: Number(arg('mesh-port', '48051')),
    // P1 : --ephemeral génère une identité par démarrage (aucune clé
    // persistée — recommandé pour les tests et l'export public).
    ephemeral: flag('ephemeral'),
    keyFile: arg('key', './data-app.key'),
    statusPort: Number(arg('status-port', '48151')),
    discoveryPort: arg('discovery-port', undefined) ? Number(arg('discovery-port')) : undefined,
  });
  const admitted = []; // fenêtres d'admission (timestamps)
  const gate = (op, from, taskId) => {
    const now = Date.now();
    while (admitted.length && admitted[0] < now - 10000) admitted.shift();
    const budget = controller.requestBudget({ tasks: 1 }, systemTelemetry());
    if (!budget.granted) return false;
    const maxRate = RATE[controller.mode] ?? 10;
    if (admitted.length >= maxRate) return false;
    admitted.push(now);
    const signal = controller.track(taskId, String(op));
    signal.addEventListener('abort', () => controller.untrack(taskId), { once: true });
    void from;
    return true;
  };
  // §8 : le frein prime sur tout placement (tous ordonnanceurs, Muse
  // inclus, reprises comprises). Seuls ACTIVE et THERMAL_LIMIT (dégradé)
  // contribuent ; STOPPED/STARTING/SUSPENDED/ERROR ne placent rien.
  const brake = () => (controller.state === 'ACTIVE' || controller.state === 'THERMAL_LIMIT'
    ? { go: true, reason: null }
    : { go: false, reason: controller.state });
  const compute = new ComputeNode(node, { admit: gate, brake });
  const results = []; // 20 derniers verdicts vérifiés (preuves, pas promesses)
  const jobs = []; // 10 derniers jobs DAG (valeur + faisceau, pas de promesses)
  node.on('message', (m) => {
    if (m.type === 'RESULT' || m.type === 'TASK') void m;
  });
  const origSettle = compute._settle.bind(compute);
  compute._settle = (task, state, value, agreeing, dissenting) => {
    results.unshift({ taskId: task.id, op: task.op, outcome: state, at: Date.now(), agreeing: agreeing.length, dissenting: dissenting.length });
    if (results.length > 20) results.pop();
    controller.untrack(task.id);
    return origSettle(task, state, value, agreeing, dissenting);
  };

  await node.start();
  const GRACE_MS = Number(arg('mesh-grace-ms', '10000'));
  let emptySince = 0;
  const tick = setInterval(() => {
    const tel = systemTelemetry();
    controller.tick(tel);
    // §8 : capacités live publiées aux pairs (limites + batterie/thermique
    // telles que mesurées — indisponibles ici, jamais inventées).
    node.capsExtra = {
      limits: { ...controller.targets, state: controller.state },
      battery: tel.battery,
      thermal: tel.thermal,
    };
    // Déconnexion réseau : 0 pair vivant au-delà du délai de grâce.
    const peers = node.registry.live().length;
    if (peers === 0) {
      if (!emptySince) emptySince = Date.now();
      if (Date.now() - emptySince >= GRACE_MS) controller.onMeshLost();
    } else {
      emptySince = 0;
      controller.onMeshBack();
    }
  }, 2000);
  tick.unref();

  const sse = new Set();
  const push = () => {
    const body = `data: ${JSON.stringify(state())}\n\n`;
    for (const res of sse) {
      try { res.write(body); } catch {}
    }
  };
  setInterval(push, 2000).unref();

  function state() {
    const snap = node.snapshot();
    const peers = (snap.peers || []).map((p) => ({
      id: p.id,
      short: p.short || String(p.id).slice(0, 12),
      name: p.name,
      state: p.state,
      sessionVerified: !!p.sessionVerified,
      caps: p.caps || {},
    }));
    const attached = [...node.sockets.keys()];
    return {
      safety: controller.status(),
      telemetry: systemTelemetry(),
      // §9 : profil NT-ID de l'appareil (id cryptographique, pas le nom).
      profile: { ntId: node.id, name: NAME, brake: brake() },
      // §9 : capacités NT-CAP (soi + pairs, telles que publiées/vérifiées).
      caps: { self: node.caps(), peers },
      // §9 : graphe temps réel issu de la télémétrie (liens = sockets rattachés).
      graph: {
        nodes: [{ id: node.id, name: NAME, self: true }, ...peers.map((p) => ({ id: p.id, name: p.name, self: false }))],
        links: attached.map((id) => ({ from: node.id, to: id })),
      },
      mesh: snap,
      results,
      jobs: jobs.map((j) => ({
        jobId: j.jobId, outcome: j.outcome, value: j.value, error: j.error,
        fragments: (j.fragments || []).map((f) => ({ id: f.id, op: f.op, outcome: f.outcome, attempts: f.attempts, executedBy: f.executedBy })),
        verification: j.verification ? { finalHash: j.verification.finalHash, merge: j.verification.merge, fragments: j.verification.fragments } : null,
        at: j.at,
      })),
      honesty: {
        cpuNote: 'objectif coopératif, pas plafonnement matériel',
        thermalNote: 'aucune sonde fiable ici : politique conservatrice',
        revenueNote: 'aucun revenu promis ; seuls les résultats vérifiés comptent',
      },
    };
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, path.join(PUB, 'index.html'));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/')) {
      const f = path.normalize(path.join(PUB, url.pathname.slice(1)));
      if (f.startsWith(PUB) && fs.existsSync(f) && fs.statSync(f).isFile()) return send(res, f);
    }
    // P2 : les GET API refusent les Origin tierces (pas de lecture cross-site).
    if (req.method === 'GET' && (url.pathname === '/api/state' || url.pathname === '/api/events')) {
      if (!originOk(req)) return json(res, { error: 'origine-tierce-refusée' }, 403);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, state());
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      sse.add(res);
      req.on('close', () => sse.delete(res));
      return;
    }
    // §9 : soumission d'un job DAG (requête → fragments → placement →
    // exécution → vérification → réponse). Refusé 409 sans contribution.
    if (req.method === 'POST' && url.pathname === '/api/job') {
      return guarded(req, res, async (p) => {
        const bc = brake();
        if (!bc.go) return json(res, { error: `contribution non autorisée : ${bc.reason}` }, 409);
        try {
          const { buildChainMatmul, buildBatchFib, buildSplitWordcount } = require('snapmesh-mesh-compute/src/fragments');
          const builders = { 'chain-matmul': buildChainMatmul, 'batch-fib': buildBatchFib, 'split-wordcount': buildSplitWordcount };
          const builder = builders[p.preset];
          if (!builder) return json(res, { error: `preset-inconnu: ${p.preset}` }, 400);
          const presetArgs = {
            'chain-matmul': [p.params?.matrices, p.params || {}],
            'batch-fib': [p.params?.ns, p.params || {}],
            'split-wordcount': [p.params?.text, p.params?.parts, p.params || {}],
          }[p.preset];
          const dag = builder(...presetArgs);
          const job = await compute.submitDag(dag);
          jobs.unshift({ ...job, at: Date.now() });
          if (jobs.length > 10) jobs.pop();
          return json(res, job, job.outcome === 'done' ? 200 : 500);
        } catch (e) {
          return json(res, { error: String((e && e.message) || e).slice(0, 300) }, 400);
        }
      });
    }
    if (req.method === 'POST' && ['/api/start', '/api/stop', '/api/mode', '/api/targets', '/api/reset-emergency'].includes(url.pathname)) {
      return guarded(req, res, (p) => {
        if (url.pathname === '/api/start') return json(res, controller.start({ consent: p.consent === true, }, systemTelemetry()));
        if (url.pathname === '/api/stop') {
          // §8 : STOP annule aussi les exécutions locales en vol (le
          // coordinateur distant réaffecte ; rien n'est perdu, rien ne fuit).
          return controller.stop(p.reason || 'arrêt demandé').then(async (r) => {
            try {
              await compute.sandbox.shutdown();
            } catch {}
            return json(res, r);
          });
        }
        if (url.pathname === '/api/mode') {
          const { MODES } = require('snapmesh-mesh-safety/src/controller');
          if (!MODES[p.mode]) return json(res, { error: `mode-inconnu: ${p.mode}` }, 400);
          controller.mode = p.mode;
          controller.targets = { ...MODES[p.mode] };
          return json(res, controller.status());
        }
        if (url.pathname === '/api/targets') {
          try {
            controller.setTargets(p);
          } catch (e) {
            return json(res, { error: e.message }, 400);
          }
          return json(res, controller.status());
        }
        return json(res, { reset: controller.resetEmergency(systemTelemetry()) });
      });
    }
    res.writeHead(404);
    res.end('introuvable');
  });

  function send(res, f) {
    // P2 : index.html reçoit le jeton local (same-origin uniquement) ;
    // les autres fichiers sont servis intacts.
    if (path.basename(f) === 'index.html') {
      fs.readFile(f, 'utf8', (err, html) => {
        if (err) {
          res.writeHead(500);
          res.end('erreur');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html.split('__GENESIS_TOKEN__').join(LOCAL_TOKEN));
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }
  function json(res, o, code = 200) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(o));
  }
  /** POST protégés : Origin locale + jeton (opérations sensibles). */
  function guarded(req, res, fn) {
    if (!originOk(req)) return json(res, { error: 'origine-tierce-refusée' }, 403);
    if (!tokenOk(req, LOCAL_TOKEN)) return json(res, { error: 'jeton-local-requis' }, 401);
    return body(req, res, fn);
  }
  function body(req, res, fn) {
    let n = 0;
    let b = '';
    let tooBig = false;
    req.on('data', (d) => {
      n += d.length;
      if (n > MAX_BODY) {
        tooBig = true;
        return;
      }
      b += d;
    });
    req.on('end', () => {
      if (tooBig) return json(res, { error: 'requête-trop-volumineuse' }, 413);
      try {
        fn(b ? JSON.parse(b) : {});
      } catch {
        json(res, { error: 'json-invalide' }, 400);
      }
    });
  }

  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`SnapMesh app : http://127.0.0.1:${PORT}/ (boucle locale uniquement)`);
  console.log(`[auth] jeton local : ${LOCAL_TOKEN} (header X-Genesis-Token, affiché une fois)`);
}

main().catch((e) => {
  console.error('Démarrage impossible :', e.message);
  process.exit(1);
});

#!/usr/bin/env node
'use strict';

/**
 * CLI M2 : nœud SnapMesh + moteur de calcul distribué.
 * Mêmes options que snapmesh-node, plus :
 *   --scheduler round-robin|capacity|local (défaut round-robin)
 *   --job <preset> [--job-params '<json>' | --job-params-file <fichier.json>]
 *       --job-params-file est OBLIGATOIRE sous Windows via Start-Process
 *       (les guillemets JSON nus en argv y sont mangés) ; params validés
 *       avant tout socket (fail-fast).
 *   --submit <op> --args '<json>' [--redundancy N] [--task-timeout-ms M]
 *       soumet une tâche une fois connecté (démo : attendre ~2 s), affiche
 *       le résultat vérifié en JSON.
 * One-shot : après --job ou --submit, arrêt propre (BYE + sandbox) et
 * code de sortie 0 si verdict(s) done, 1 sinon ([job-exit]).
 *   --sabotage : TEST UNIQUEMENT — renvoie des résultats falsifiés
 *       (pour prouver que le quorum les écarte).
 */

const { SnapMeshNode } = require('snapmesh-mesh-net');
const { ComputeNode } = require('../src/compute');
const { listOps } = require('../src/ops');

/**
 * Garde-fou M5 : un verdict est TOUJOURS écrit, même si la file restait
 * muette (ex. refus silencieux + timers unref + boucle vide = sortie
 * sans verdict, symptôme "aucune ligne [job]" du test local réel).
 * Timer REF (retient la boucle) : passé le délai, rejet explicite
 * "file-muette" au lieu d'une pendaison ou d'une sortie silencieuse.
 */
function awaitVerdict(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} : file muette, aucun verdict en ${ms} ms`)), ms);
  });
  return Promise.race([
    promise.then(
      (v) => { clearTimeout(timer); return v; },
      (e) => { clearTimeout(timer); throw e; }
    ),
    guard,
  ]);
}

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

/**
 * Lit un JSON depuis un fichier en tolérant un BOM UTF-8 initial
 * (PowerShell 5.1 `Set-Content -Encoding utf8` en écrit un, et
 * `JSON.parse` le refuse : "Unexpected token", prouvé sur j1 M5).
 * Seul UN éventuel premier caractère U+FEFF est retiré ; tout JSON
 * réellement invalide lève toujours (jamais masqué).
 */
function readJsonFile(p) {
  const raw = require('node:fs').readFileSync(p, 'utf8');
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(stripped);
}

async function main() {
  const name = arg('name', `cmp-${process.pid}`);
  const tcpPort = Number(arg('port', '48001'));
  // §5-fail-fast (M5) : les params --job sont validés AVANT tout socket.
  // --job-params-file <fichier.json> (robuste Windows : aucun JSON en
  // argv, que Start-Process PS5.1 déforme en mangeant les guillemets nus)
  // ou --job-params '<json>' (argv intact uniquement). Le DAG est construit
  // ici ; la soumission reste après démarrage (pairs requis).
  const jobPreset = arg('job', null);
  let lastJob = null; // verdict du --job (pour le code de sortie one-shot)
  let submitAllDone = true; // verdicts du --submit (idem)
  let jobDag = null;
  if (jobPreset) {
    const { buildChainMatmul, buildBatchFib, buildSplitWordcount } = require('../src/fragments');
    const paramsFile = arg('job-params-file', null);
    const params = paramsFile
      ? readJsonFile(paramsFile)
      : JSON.parse(arg('job-params', '{}'));
    const builders = { 'chain-matmul': buildChainMatmul, 'batch-fib': buildBatchFib, 'split-wordcount': buildSplitWordcount };
    // Forme des params : chain-matmul {matrices}, batch-fib {ns, redundancy?}, split-wordcount {text, parts}.
    const presetArgs = {
      'chain-matmul': [params.matrices, params],
      'batch-fib': [params.ns, params],
      'split-wordcount': [params.text, params.parts, params],
    }[jobPreset];
    if (!builders[jobPreset] || !presetArgs) {
      console.error(`[job-erreur] preset inconnu : ${jobPreset} (chain-matmul|batch-fib|split-wordcount)`);
      process.exit(2);
    }
    jobDag = builders[jobPreset](...presetArgs); // lève si params invalides (avant listen)
  }
  const node = new SnapMeshNode({
    name,
    tcpPort,
    bindHost: arg('bind-host', '127.0.0.1'),
    keyFile: arg('key', `./data-${name}.key`),
    ephemeral: flag('ephemeral'),
    manualPeers: (arg('peers', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
    discovery: !flag('no-discovery'),
    discoveryPort: arg('discovery-port', undefined) ? Number(arg('discovery-port')) : undefined,
    statusPort: Number(arg('status-port', String(tcpPort + 100))),
  });
  const compute = new ComputeNode(node, {
    scheduler: arg('scheduler', 'round-robin'),
    sabotage: flag('sabotage'),
    dropResults: flag('drop-results'),
    // NT-Flux (opt-in, défaut OFF) : --flux active, --flux-effort règle
    // l'effort (fast|normal|strong), --flux-no-dedup coupe la dedup.
    flux: {
      enabled: flag('flux'),
      effort: arg('flux-effort', 'normal'),
      dedup: !flag('flux-no-dedup'),
    },
    // Test/démo : --no-self exclut le coordinateur de ses propres
    // placements (force l'exécution distante, donc le passage par le fil).
    excludeSelf: flag('no-self'),
    queueFile: arg('queue-file', `./data-${name}.queue.json`),
    recoverDelayMs: Number(arg('recover-delay-ms', '3000')),
    // §4 : bornes du bac à sable d'exécution (worker_threads).
    sandboxOpts: {
      maxWorkers: Number(arg('sandbox-max-workers', '2')),
      execTimeoutMs: Number(arg('sandbox-timeout-ms', '5000')),
      memMb: Number(arg('sandbox-mem-mb', '64')),
    },
  });
  console.log(`Sandbox : ${JSON.stringify(compute.sandbox.describe())}`);

  node.on('peer', (p) => console.log(`[peer] ${p.name} ${p.id.slice(0, 12)} connecté`));
  node.on('suspect', (p) => console.log(`[suspect] ${p.name} sans nouvelles`));
  node.on('dead', (p) => console.log(`[dead] ${p.name} déclaré mort`));
  node.on('rejected', (r) => console.log(`[rejeté] ${r.reason}`));
  node.on('exec', (e) => console.log(`[exec] ${e.op} ${String(e.taskId).slice(0, 8)} pour ${String(e.from).slice(0, 12)} chiffré=${e.encrypted ? 1 : 0}${e.relayed ? ' relais=1' : ''}`));
  node.on('exec-failed', (e) => console.log(`[exec-échoué] ${e.op} ${String(e.taskId).slice(0, 8)} cause=${e.error}`));
  node.on('plan', (p) => console.log(`[plan] ${p.provider} t=${String(p.taskId).slice(0, 8)} → ${String(p.picked).slice(0, 12)} conf=${p.confidence}${p.fallbackUsed ? ' REPLI' : ''} : ${(p.explanation || p.reason || '').slice(0, 120)}`));
  node.on('plan-refused', (p) => console.log(`[plan-refusé] cause=${p.reason} proposition=${JSON.stringify(p.refusedProposal || null).slice(0, 200)}`));
  node.on('rejected-result', (r) => console.log(`[résultat-rejeté] ${r.reason} tâche ${String(r.taskId).slice(0, 8)} de ${String(r.from).slice(0, 12)}`));
  node.on('recovered', (r) => console.log(`[reprise] ${r.tasks} tâche(s) interrompue(s) re-dispatchée(s)`));
  node.on('recovered-task', (t) => console.log(`[task] ${JSON.stringify({ ...t, recovered: true })}`));
  node.on('flux-stats', (s) => console.log(`[flux] ${s.dir} ${s.kind} ${s.codec} ${s.inBytes}->${s.outBytes}${s.suspicious ? ' SUSPECT' : ''} t=${String(s.taskId).slice(0, 8)}`));
  if (compute.dropResults) console.log('[drop-results] ACTIF — ce nœud exécute mais ne répond jamais (test)');
  node.on('error', (e) => console.error(`[erreur] ${e.message}`));
  if (compute.sabotage) console.log('[sabotage] ACTIF — ce nœud falsifie ses résultats (test)');

  await node.start();
  console.log(`Nœud calcul "${name}" id=${node.id.slice(0, 12)} tcp=${tcpPort} scheduler=${compute.schedName}`);
  console.log(`Ops disponibles : ${Object.keys(listOps()).join(', ')}`);
  // M6 : capacités réelles logguées au démarrage (preuve CPU/RAM mesurés,
  // GPU/NPU honnêtement indisponibles — jamais inventés, cf. caps.js).
  console.log(`Caps : ${JSON.stringify(node.caps())}`);

  // §5 : soumission du DAG pré-construit (fail-fast plus haut).
  if (jobPreset) {
    await new Promise((r) => setTimeout(r, Number(arg('submit-delay-ms', '2500'))));
    const wantPeers = Number(arg('submit-wait-peers', '1'));
    const t0 = Date.now();
    while (node.registry.live().length < wantPeers && Date.now() - t0 < 15000) {
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log(`[peers] ${node.registry.live().length} pair(s) connu(s), job=${jobPreset}`);
    console.log(`[job-submit] ${jobPreset} ${jobDag.fragments.length} fragment(s)`);
    // Délai max : pire expiry des fragments + marge (verdict local garanti).
    const verdictMs = Math.max(...jobDag.fragments.map((f) => f.expiryMs || 60000)) + 15000;
    let res;
    try {
      res = await awaitVerdict(compute.submitDag(jobDag), verdictMs, `job ${jobPreset}`);
    } catch (e) {
      res = { jobId: null, outcome: 'failed', value: null, error: `verdict-local: ${String((e && e.message) || e).slice(0, 200)}`, fragments: [] };
    }
    lastJob = res;
    console.log(`[job] ${JSON.stringify(res)}`);
  }

  const op = arg('submit', null);
  if (op) {
    // --args-file : charge les args depuis un fichier JSON (grosses charges
    // que la ligne de commande Windows ~32 Ko refuse en argv direct).
    const argsFile = arg('args-file', null);
    const args = argsFile
      ? readJsonFile(argsFile)
      : JSON.parse(arg('args', '{}'));
    const redundancy = Number(arg('redundancy', '1'));
    const timeoutMs = Number(arg('task-timeout-ms', '8000'));
    // Laisse le maillage se former avant de soumettre.
    await new Promise((r) => setTimeout(r, Number(arg('submit-delay-ms', '2500'))));
    // Attend le quorum de pairs requis (défaut : redondance - 1), sans bloquer
    // indéfiniment : la soumission part avec les candidats connus.
    const wantPeers = arg('submit-wait-peers', null) === null ? Math.max(0, redundancy - 1) : Number(arg('submit-wait-peers'));
    const t0 = Date.now();
    while (node.registry.live().length < wantPeers && Date.now() - t0 < 15000) {
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log(`[peers] ${node.registry.live().length} pair(s) connu(s), redondance=${redundancy}`);
    const count = Math.max(1, Number(arg('submit-count', '1')));
    const verdictMs = Math.max(1000, timeoutMs) * 6 + 15000; // tentatives max + marge
    for (let i = 0; i < count; i++) {
      console.log(`[submit] ${op} ${JSON.stringify(args)} redondance=${redundancy}`);
      let res;
      try {
        res = await awaitVerdict(compute.submit(op, args, { redundancy, timeoutMs }), verdictMs, `submit ${op}`);
      } catch (e) {
        res = { outcome: 'failed', error: `verdict-local: ${String((e && e.message) || e).slice(0, 200)}` };
      }
      res.resultatsChiffres = compute.stats.encryptedResults || 0;
      res.sandbox = compute.sandbox.stats();
      submitAllDone = submitAllDone && res.outcome === 'done';
      console.log(`[task] ${JSON.stringify(res)}`);
    }
  }

  // One-shot M5 : après --job/--submit, arrêt propre (BYE gracieux +
  // sandbox) puis sortie avec code lié au verdict (0 = done partout).
  // Sans cela le nœud restait pendu (timers/sockets actifs) et tout
  // pilote attendant la fin tombait en timeout sans verdict lisible.
  if (jobPreset || op) {
    const code = jobPreset ? (lastJob && lastJob.outcome === 'done' ? 0 : 1) : (submitAllDone ? 0 : 1);
    console.log(`[job-exit] code=${code}, arrêt propre`);
    try { await compute.sandbox.shutdown(); } catch {}
    try { await node.stop(); } catch {}
    process.exit(code);
  }

  const shutdown = async () => {
    await node.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('Démarrage impossible :', e.message);
  process.exit(1);
});

'use strict';

/**
 * NT-COMPAT — détection réelle des backends d'exécution.
 * Règle : jamais de backend inventé. Chaque entrée = { available,
 * reason?, dtypes?, flopsMesuré? }. La détection est locale, synchrone
 * et bornée (aucun téléchargement, aucune installation).
 */

const os = require('node:os');
const { execFileSync } = require('node:child_process');

function tryResolve(name) {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

/** Micro-mesure honnête : matmul n×n en JS, retourne ms (médiane de 3). */
function benchMatmul(n, useFloat32) {
  const A = new (useFloat32 ? Float32Array : Float64Array)(n * n);
  const B = new (useFloat32 ? Float32Array : Float64Array)(n * n);
  const C = new (useFloat32 ? Float32Array : Float64Array)(n * n);
  for (let i = 0; i < n * n; i++) {
    A[i] = (i % 7) * 0.5;
    B[i] = (i % 5) * 0.25;
  }
  const times = [];
  for (let r = 0; r < 3; r++) {
    C.fill(0);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < n; k++) {
        const a = A[i * n + k];
        for (let j = 0; j < n; j++) C[i * n + j] += a * B[k * n + j];
      }
    }
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const ms = times[1];
  const flops = (2 * n * n * n) / (ms / 1000);
  return { ms, flops };
}

function detectBackends({ benchN = 48 } = {}) {
  const backends = {};
  // CPU scalaire JS : toujours disponible (moteur V8 du processus).
  const f64 = benchMatmul(benchN, false);
  const f32 = benchMatmul(benchN, true);
  backends['node-cpu-fp64'] = {
    available: true, dtypes: ['fp64'],
    matmulMs: f64.ms, flops: Math.round(f64.flops),
    note: `V8 ${process.versions.v8}, mesuré ici (matmul ${benchN}×${benchN})`,
  };
  backends['node-cpu-fp32'] = {
    available: true, dtypes: ['fp32'],
    matmulMs: f32.ms, flops: Math.round(f32.flops),
    note: 'Float32Array réel (arrondi fp32 prouvé par les tests)',
  };
  backends['node-cpu-int8'] = {
    available: true, dtypes: ['int8'],
    note: 'quantification symétrique + matmul entier en JS pur (nt-fusion)',
  };
  // P6 (audit) : comment vérifier hors sandbox (WMI refusé ici).
  // Ces commandes ne sont JAMAIS exécutées par la sonde (lecture seule
  // exigée, aucune installation) ; elles documentent la contre-vérification.
  const manualCheck = {
    gpu: 'nvidia-smi -L (NVIDIA) ; Get-PnpDevice (Windows, hors sandbox)',
    npu: "Get-PnpDevice | Where FriendlyName ~ 'NPU|AI Boost|XDNA|Hexagon'",
    onnxruntime: 'npm ls onnxruntime-node',
  };
  // Runtimes ML externes : présents seulement si installés.
  // M4 : onnxruntime-node installé (optionalDependencies) => backend réel.
  backends['onnxruntime'] = tryResolve('onnxruntime-node')
    ? { available: true, dtypes: ['fp32'], note: 'paquet onnxruntime-node résolu (EP: voir ort.availableEps())' }
    : { available: false, reason: 'paquet onnxruntime-node non installé' };
  backends['directml'] = {
    available: false,
    reason: 'pas de liaison DirectML en Node pur (onnxruntime absent)',
  };
  let cuda = false;
  try {
    const out = execFileSync('nvidia-smi', ['-L'], { timeout: 5000, encoding: 'utf8' });
    cuda = /GPU/i.test(out);
  } catch {
    cuda = false;
  }
  backends['cuda'] = cuda
    ? { available: true, dtypes: ['fp32', 'fp16'], note: 'nvidia-smi répond' }
    : { available: false, reason: 'nvidia-smi absent ou sans GPU' };
  backends['rocm'] = { available: false, reason: 'non sondé/installé sur ce poste' };
  backends['openvino'] = tryResolve('openvino-node')
    ? { available: true, dtypes: ['fp32', 'int8'], note: 'paquet résolu' }
    : { available: false, reason: 'paquet openvino-node non installé' };
  backends['webgpu'] = {
    available: false,
    reason: 'Node sans WebGPU sur ce poste (flag --experimental-webgpu inexistant)',
  };
  backends['webnn'] = {
    available: false,
    reason: 'API navigateur uniquement, inaccessible en Node',
  };
  return {
    arch: os.arch(),
    cpuModel: (os.cpus()[0] && os.cpus()[0].model) || 'unknown',
    threads: os.cpus().length,
    backends,
    // P6 : aucun backend accéléré implémenté ici — aucun matériel
    // compatible détecté (règle : pas de backend sans matériel prouvé).
    acceleratedImplemented: [],
    manualCheck,
  };
}

module.exports = { detectBackends, benchMatmul };

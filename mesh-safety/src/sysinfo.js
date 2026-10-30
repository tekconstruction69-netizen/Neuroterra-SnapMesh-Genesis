'use strict';

/**
 * Analyse matérielle système (Windows d'abord) — lecture seule, aucun
 * droit administrateur, aucune installation. Chaque champ est étiqueté :
 * 'mesuré' (valeur lue/mesurée ici), 'détecté' (présence constatée),
 * 'non disponible' (sonde refusée/absente, motif). On n'invente rien :
 * WMI/CIM refusé => non disponible ; thermique sans capteur fiable =>
 * non disponible. Le microbenchmark réutilise la sonde NT-COMPAT.
 */

const os = require('node:os');
const { execFileSync } = require('node:child_process');

const NA = (reason) => ({ statut: 'non disponible', valeur: null, raison: reason });

function psJson(runner, script) {
  const quiet = `$ErrorActionPreference='SilentlyContinue'; ${script}`;
  const out = runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', quiet], { timeout: 8000, encoding: 'utf8', windowsHide: true });
  return JSON.parse(String(out).trim());
}

/**
 * runner injectable (tests) : (cmd, args, opts) => stdout, lève si refusé.
 * Par défaut execFileSync réel. Aucune élévation, aucun service.
 */
function probeSystem({ runner = execFileSync, bench = null } = {}) {
  const cpus = os.cpus();
  const info = {
    plateforme: { statut: 'détecté', valeur: `${os.platform()} ${os.arch()}` },
    cpuModele: { statut: 'détecté', valeur: (cpus[0] && cpus[0].model) || null },
    cpuLogiques: { statut: 'détecté', valeur: cpus.length },
    cpuPhysiques: NA('non exposé par Node'),
    ramTotaleGo: { statut: 'mesuré', valeur: +(os.totalmem() / 2 ** 30).toFixed(2) },
    ramLibreGo: { statut: 'mesuré', valeur: +(os.freemem() / 2 ** 30).toFixed(2) },
    gpuModele: NA('sonde GPU non concluante'),
    vramGo: NA('VRAM non exposée par les sondes autorisées'),
    gpuCharge: NA('charge GPU non exposée sans outil constructeur'),
    thermique: NA('pas de télémétrie thermique fiable accessible sans privilèges (politique conservatrice appliquée)'),
    batterie: NA('pas d\u2019API batterie en Node sur ce poste'),
    wifiAdapter: NA('adaptateur Wi-Fi non sondé'),
    wifiDirect: NA('Wi-Fi Direct non sondé (aucune modification des réglages Wi-Fi)'),
    reseau: {
      statut: 'détecté',
      valeur: Object.entries(os.networkInterfaces())
        .filter(([, v]) => v && v.some((a) => !a.internal))
        .map(([k]) => k),
    },
    microbench: bench || NA('non exécuté'),
  };
  if (os.platform() === 'win32') {
    try {
      const cpu = psJson(runner, 'Get-CimInstance Win32_Processor | Select-Object -First 1 NumberOfCores,NumberOfLogicalProcessors,Name | ConvertTo-Json -Compress');
      if (cpu && cpu.NumberOfCores) {
        info.cpuPhysiques = { statut: 'mesuré', valeur: cpu.NumberOfCores };
        if (cpu.Name) info.cpuModele = { statut: 'détecté', valeur: String(cpu.Name).trim() };
      }
    } catch { /* CIM refusé : champs conservés en non disponible */ }
    try {
      const gpu = psJson(runner, 'Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json -Compress');
      if (gpu && gpu.Name) {
        info.gpuModele = { statut: 'détecté', valeur: String(gpu.Name).trim() };
        if (gpu.AdapterRAM) info.vramGo = { statut: 'détecté', valeur: +(gpu.AdapterRAM / 2 ** 30).toFixed(2), note: 'AdapterRAM déclaré (borne CIM connue, pas une mesure libre)' };
      }
    } catch { /* CIM refusé */ }
    try {
      // Lecture seule : netsh rapporte l'adaptateur et le support pilote.
      // Aucune commande d'activation n'est jamais émise ici.
      const out = String(runner('netsh.exe', ['wlan', 'show', 'drivers'], { timeout: 8000, encoding: 'utf8', windowsHide: true }) || '');
      const name = (out.match(/Interface name\s*:\s*(.+)/i) || [])[1];
      if (name) info.wifiAdapter = { statut: 'détecté', valeur: name.trim() };
      if (/Wi-Fi Direct Device\s*:\s*Available/i.test(out) || /Wireless Display Supported\s*:\s*Yes/i.test(out)) {
        info.wifiDirect = { statut: 'détecté', valeur: 'pilote annonce Wi-Fi Direct (appairage système requis, jamais forcé)' };
      } else if (name) {
        info.wifiDirect = { statut: 'non disponible', valeur: null, raison: 'pilote sans support Wi-Fi Direct annoncé' };
      }
    } catch { /* netsh indisponible/refusé : non disponible conservé */ }
    try {
      const bat = psJson(runner, 'Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress');
      if (bat && bat.EstimatedChargeRemaining != null) {
        info.batterie = { statut: 'mesuré', valeur: { pct: bat.EstimatedChargeRemaining, statutCode: bat.BatteryStatus } };
      }
    } catch { /* CIM refusé */ }
  }
  return info;
}

/** Microbenchmark CPU borné et réel (matmul mesurée NT-COMPAT, < 100 ms). */
function microbenchCpu() {
  const { benchMatmul } = require('../../nt-compat/src/backends');
  const r = benchMatmul(48, true);
  return { statut: 'mesuré', valeur: { matmul48Fp32Ms: +r.ms.toFixed(3), gflops: +(r.flops / 1e9).toFixed(3) }, note: 'borné : 3 répétitions 48x48' };
}

module.exports = { probeSystem, microbenchCpu };

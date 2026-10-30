'use strict';

/**
 * Adaptateurs de plateforme SnapMesh (détection lecture seule, honnête).
 * Chaque adaptateur rapporte { transport: { etat, detail } } avec etat ∈
 * 'confirme' | 'partiel-sonde' | 'non-verifie' | 'incompatible'.
 * Aucun adaptateur théorique n'est marqué opérationnel sans preuve locale.
 * runner injectable (cmd, args, opts) => stdout ; lève si indisponible.
 */

function check(runner, cmd, args) {
  try {
    const out = String(runner(cmd, args, { timeout: 8000, encoding: 'utf8', windowsHide: true }) || '');
    return out;
  } catch {
    return null;
  }
}

function windows(runner) {
  const a = { plateforme: 'windows', wifiDirect: null, ble: null, internet: null };
  const drv = check(runner, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='SilentlyContinue'; netsh wlan show drivers"]);
  if (drv === null) {
    a.wifiDirect = { etat: 'non-verifie', detail: 'sonde indisponible ici' };
  } else if (/Wi-Fi Direct Device\s*:\s*Available/i.test(drv)) {
    a.wifiDirect = { etat: 'confirme', detail: 'pilote annonce Wi-Fi Direct (appairage système requis)' };
  } else if (/Affichage sans fil pris en charge\s*:\s*Oui|Wireless Display Supported\s*:\s*Yes/i.test(drv)) {
    a.wifiDirect = { etat: 'partiel-sonde', detail: 'Miracast seul : Wi-Fi Direct probable, NON prouvé, appairage requis' };
  } else {
    a.wifiDirect = { etat: 'non-verifie', detail: 'aucun indice pilote' };
  }
  a.ble = { etat: 'non-verifie', detail: 'radio BLE non sondée (Web Bluetooth navigateur uniquement)' };
  a.internet = { etat: 'confirme', detail: 'TCP/IP Node.js (mécanismes existants)' };
  return a;
}

function linux(runner) {
  const a = { plateforme: 'linux', wifiDirect: null, ble: null, internet: null };
  const iw = check(runner, 'iw', ['list']);
  a.wifiDirect = iw && /P2P/i.test(iw)
    ? { etat: 'partiel-sonde', detail: 'iw annonce P2P (wpa_supplicant requis, non testé)' }
    : { etat: 'non-verifie', detail: iw === null ? 'iw indisponible ici' : 'aucune capacité P2P annoncée' };
  a.ble = { etat: 'non-verifie', detail: 'BlueZ non sondé (canal léger seulement, jamais de tâche IA)' };
  a.internet = { etat: 'confirme', detail: 'TCP/IP Node.js (mécanismes existants)' };
  return a;
}

function macos() {
  return {
    plateforme: 'macos',
    wifiDirect: { etat: 'non-verifie', detail: 'Multipeer Connectivity à étudier (natif requis, non testé)' },
    ble: { etat: 'non-verifie', detail: 'CoreBluetooth natif requis (canal léger seulement)' },
    internet: { etat: 'confirme', detail: 'TCP/IP Node.js (mécanismes existants)' },
  };
}

function android() {
  return {
    plateforme: 'android',
    wifiDirect: { etat: 'non-verifie', detail: 'WifiP2pManager natif requis (application dédiée, non construite)' },
    ble: { etat: 'non-verifie', detail: 'BLE natif requis (découverte légère seulement)' },
    internet: { etat: 'non-verifie', detail: 'TCP/IP à valider dans l\u2019application native' },
  };
}

function ios() {
  return {
    plateforme: 'ios',
    wifiDirect: { etat: 'incompatible', detail: 'aucune API Wi-Fi Direct/Aware en PWA Safari ; passerelle HTTPS en relais' },
    ble: { etat: 'incompatible', detail: 'Web Bluetooth absent de Safari ; natif CoreBluetooth hors PWA' },
    internet: { etat: 'partiel-sonde', detail: 'HTTPS passerelle (relais non déployé)' },
  };
}

/** Détecte la plateforme courante (os.platform injectable pour tests). */
function detect({ platform = process.platform, runner = null } = {}) {
  const noop = () => { throw new Error('sans-runner'); };
  const r = runner || noop;
  if (platform === 'win32') return windows(r);
  if (platform === 'linux') return linux(r);
  if (platform === 'darwin') return macos();
  if (platform === 'android') return android();
  if (platform === 'ios') return ios();
  return { plateforme: platform, wifiDirect: { etat: 'non-verifie', detail: 'plateforme non étudiée' }, ble: { etat: 'non-verifie', detail: '' }, internet: { etat: 'non-verifie', detail: '' } };
}

module.exports = { detect, windows, linux, macos, android, ios };

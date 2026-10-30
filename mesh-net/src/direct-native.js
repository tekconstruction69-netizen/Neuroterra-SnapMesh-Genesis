'use strict';

/**
 * Pont natif Windows pour SnapMesh Direct (lecture seule).
 * Exécute la sonde PowerShell `M7-WIFIDIRECT-PROBE.ps1` et rapporte :
 * adaptateur présent/absent, Wi-Fi Direct confirmé/probable/non-confirmé.
 * N'ACTIVE rien, n'appaire rien, ne modifie aucun réglage : l'appairage
 * reste un geste volontaire de l'opérateur dans l'interface Windows,
 * puis SnapMesh utilise le lien IP direct résultant (mécanismes NT
 * existants : HELLO signé, challenge, chiffrement, quorum).
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

function parseProbeJson(stdout) {
  const j = JSON.parse(String(stdout).trim());
  if (!j || j.v !== 1) throw new Error('direct-native: sortie de sonde invalide');
  return j;
}

/** runner injectable (cmd, args, opts) => stdout ; par défaut execFileSync. */
function probeDirect({ runner = execFileSync } = {}) {
  const script = path.join(__dirname, '..', '..', 'scripts', 'M7-WIFIDIRECT-PROBE.ps1');
  const out = runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { timeout: 15000, encoding: 'utf8', windowsHide: true });
  return parseProbeJson(out);
}

module.exports = { probeDirect, parseProbeJson };

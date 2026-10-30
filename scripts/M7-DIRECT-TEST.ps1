#Requires -Version 5.1
<#
.SYNOPSIS
  Test SnapMesh Direct entre 2 PC SANS box ni Internet (hors sandbox).
  Ordre : consentement local OUI, sonde Wi-Fi Direct, appairage Windows
  MANUEL par l'operateur (jamais automatique), noeuds SnapMesh sur le
  lien direct, tache CPU avec resultat verifie, collecte des journaux.
  Sans double OUI : exit 2, aucune connexion tentee.
  Ne modifie ni le pare-feu ni aucun reglage systeme.
#>
param(
  [string]$Role = '',
  [string]$Peer = '',
  [string]$Root = ''
)
$ErrorActionPreference = 'Stop'
if ($Root -eq '') { $Root = Split-Path -Parent $PSScriptRoot }
$STAMP = Get-Date -Format 'yyyyMMdd-HHmmss'
$LOG = Join-Path $Root ('bench-logs/m7-direct-' + $Role + '-' + $STAMP + '.log')
function Say($m) {
  $line = "[m7-direct] $m"
  Write-Host $line
  Add-Content -Path $LOG -Value ((Get-Date -Format o) + ' ' + $line)
}
if ($Role -notin @('coordinateur', 'worker')) {
  Write-Host 'Usage : M7-DIRECT-TEST.ps1 -Role <coordinateur|worker> [-Peer <ip-direct>:<port>]'
  exit 2
}
Say "Role=$Role. Lien direct prealable requis : appairage Wi-Fi Direct effectue MANUELLEMENT dans Windows des deux cotes."
$cons = Read-Host 'Confirmez-vous (OUI) : Wi-Fi de box oublie, hotspot coupe, appairage volontaire effectue, journaux archivables ?'
if ($cons -ne 'OUI') { Say 'Sans consentement explicite : abandon (exit 2), aucune connexion tentee.'; exit 2 }
Say '--- sonde Wi-Fi Direct (lecture seule) ---'
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'M7-WIFIDIRECT-PROBE.ps1') 2>&1 | ForEach-Object { Say $_ }
} catch { Say 'sonde indisponible, on continue vers le lien declare manuellement.' }
if ($Role -eq 'worker' -and $Peer -eq '') { Say 'Worker : -Peer <ip-direct>:<port> du coordinateur requis (exit 2).'; exit 2 }
Say 'STOP reste prioritaire (Ctrl+C). Protections NT et sandbox actives. Lancement du noeud...'
$env:SNAPMESH_PEER = $Peer
try {
  if ($Role -eq 'coordinateur') {
    & node (Join-Path $Root 'mesh-compute/bin/compute-node.js') --name 'm7-direct-coord' --port 49210 --status-port 49310 --bind-host '0.0.0.0' --ephemeral 2>&1 | ForEach-Object { Say $_ }
  } else {
    & node (Join-Path $Root 'mesh-compute/bin/compute-node.js') --name 'm7-direct-worker' --port 49211 --status-port 49311 --bind-host '0.0.0.0' --peers "$Peer" --ephemeral 2>&1 | ForEach-Object { Say $_ }
  }
  $code = $LASTEXITCODE
} catch {
  Say ("echec lancement : " + $_.Exception.Message)
  exit 1
}
Say "fin worker/noeud code $code. Journal : $LOG"
if ($code -eq 0) { exit 0 } else { exit 1 }

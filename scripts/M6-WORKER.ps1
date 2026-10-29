#Requires -Version 5.1
<#
.SYNOPSIS
  M6-WORKER : agent worker SnapMesh pour un second PC Windows (LAN prive).
  Rejoint le coordinateur et execute uniquement les ops whitelisteees.
  Ne modifie JAMAIS le pare-feu ni aucun reglage systeme. Si Windows
  propose un acces reseau : accepter uniquement les reseaux PRIVES.
  Compatible Windows PowerShell 5.1 (ASCII uniquement).
.USAGE (PowerShell ordinaire, hors sandbox Muse)
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\M6-WORKER.ps1 -Peer 192.168.1.10:49210
  Exit 0 = arret propre ; 1 = echec fonctionnel ; 2 = environnement bloque
  ou sans consentement. STOP = Ctrl+C dans cette fenetre (BYE gracieux).
  SECURITE : --ephemeral (aucune cle persistee), bornes sandbox actives
  (2 workers, 64 Mo, 5 s/op - voir mesh-compute). Aucun code arbitraire.
#>
param(
  [string]$Peer = '',
  [string]$BindHost = '0.0.0.0',
  [int]$Port = 49210,
  [int]$StatusPort = 49310,
  [string]$Name = 'm6-worker'
)
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $PSScriptRoot
$STAMP = Get-Date -Format 'yyyyMMdd-HHmmss'
$LOGDIR = Join-Path $ROOT 'bench-logs'
New-Item -ItemType Directory -Force $LOGDIR | Out-Null
$LOG = Join-Path $LOGDIR ('m6-worker-' + $STAMP + '.log')
function Say($m) {
  $line = "[m6-worker] $m"
  Write-Host $line
  Add-Content -Path $LOG -Value ((Get-Date -Format o) + ' ' + $line)
}
Say 'Worker M6 : LAN prive uniquement, aucun reseau public/invite.'
Say 'Le pare-feu ne sera JAMAIS modifie par ce script.'
$cons = Read-Host 'Vous consentez a contribuer ce PC (ops whitelisteees, bornes affichees) ? [OUI/non]'
if ($cons -ne 'OUI') { Say 'Sans consentement explicite : abandon (exit 2).'; exit 2 }
$nv = $null
try { $nv = (node --version 2>&1).ToString().Trim() } catch { $nv = $null }
if (-not $nv) { Say 'Node.js introuvable : installer Node 18+ depuis nodejs.org (exit 2).'; exit 2 }
Say "node $nv"
$bin = Join-Path $ROOT 'mesh-compute/bin/compute-node.js'
if (-not (Test-Path $bin)) { Say "Worker introuvable : $bin (exit 2)."; exit 2 }
$argsList = @($bin, '--name', $Name, '--port', "$Port", '--status-port', "$StatusPort", '--bind-host', $BindHost, '--ephemeral')
if ($Peer -ne '') { $argsList += @('--peers', $Peer) }
Say ("demarrage worker port $Port (STOP = Ctrl+C, BYE gracieux)")
try {
  & node @argsList 2>&1 | ForEach-Object { Say $_ }
  $code = $LASTEXITCODE
} catch {
  Say ("echec lancement : " + $_.Exception.Message)
  if ($_.Exception.Message -match 'EACCES|access') { exit 2 }
  exit 1
}
Say "arret worker code $code"
if ($code -eq 0) { exit 0 } else { exit 1 }

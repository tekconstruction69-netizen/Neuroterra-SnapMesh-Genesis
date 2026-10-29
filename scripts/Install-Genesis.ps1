#Requires -Version 5.1
<#
.SYNOPSIS
  Install-Genesis : installe l'application Neuroterra Genesis sur Windows.
  Cree les raccourcis Bureau et Menu Demarrer vers le lanceur local et,
  en option, vers le worker NT. Ne modifie ni le pare-feu, ni aucun
  reglage systeme, n'installe aucun service et ne demande aucun droit
  administrateur. Desinstallation : supprimer les raccourcis crees.
  Compatible Windows PowerShell 5.1 (ASCII uniquement).
.USAGE (PowerShell ordinaire)
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Install-Genesis.ps1
  Exit 0 = installe ; 1 = echec ; 2 = environnement incomplet (Node absent).
  L'application reste 100 % locale (boucle 127.0.0.1) : START/STOP,
  NT-ID affiche, budgets CPU/memoire choisis dans l'interface.
  GPU : detection et affichage uniquement (aucun plafonnement promis).
  Thermique : politique conservatrice si aucune telemetrie fiable.
#>
param([switch]$NoShortcuts)
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $PSScriptRoot
function Say($m) { Write-Host "[install-genesis] $m" }
$nv = $null
try { $nv = (node --version 2>&1).ToString().Trim() } catch { $nv = $null }
if (-not $nv) {
  Say 'Node.js introuvable : installer Node 18+ depuis nodejs.org, puis relancer (exit 2).'
  exit 2
}
Say "node $nv detecte"
$launcher = Join-Path $PSScriptRoot 'Start-Genesis.ps1'
if (-not (Test-Path $launcher)) { Say "Lanceur introuvable : $launcher (exit 1)."; exit 1 }
if (-not $NoShortcuts) {
  $shell = New-Object -ComObject WScript.Shell
  $targets = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) '')
  )
  foreach ($dir in $targets) {
    if (-not $dir -or -not (Test-Path $dir)) { continue }
    $lnk = Join-Path $dir 'Neuroterra Genesis.lnk'
    $sc = $shell.CreateShortcut($lnk)
    $sc.TargetPath = 'powershell.exe'
    $sc.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`""
    $sc.WorkingDirectory = $ROOT
    $sc.Description = 'Neuroterra SnapMesh Genesis (application locale)'
    $sc.Save()
    Say "raccourci cree : $lnk"
  }
}
Say 'Installation terminee. Lancez Neuroterra Genesis depuis le raccourci,'
Say 'ou : powershell -File scripts\Start-Genesis.ps1'
Say 'Aucun port public ouvert ; STOP dans l''interface reste prioritaire.'
exit 0

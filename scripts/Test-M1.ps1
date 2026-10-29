#Requires -Version 5.1
<#
.SYNOPSIS
  Procédure indépendante M1 : rejoue la suite mesh-net et archive le journal brut.
  À exécuter dans un PowerShell Windows ordinaire (hors session Muse).
  Ne modifie aucun réglage système, n'expose rien sur le réseau public
  (loopback uniquement), ne publie rien.
.USAGE
  powershell -ExecutionPolicy Bypass -File scripts\Test-M1.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location (Join-Path $root 'mesh-net')
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $root ("bench-logs\m1-{0}.log" -f $stamp)
node --version 2>&1 | Tee-Object -FilePath $log | Write-Output
'--- suite : unit + integration (processus reels, loopback) ---' | Tee-Object -FilePath $log -Append | Write-Output
node --test --test-timeout=120000 test/unit.test.js test/integration.test.js 2>&1 | Tee-Object -FilePath $log -Append | Write-Output
$code = $LASTEXITCODE
'--- code de sortie : {0} ---' -f $code | Tee-Object -FilePath $log -Append | Write-Output
'Journal brut : {0}' -f $log | Write-Output
if ($code -ne 0) { Write-Output 'M1 NON VALIDE : voir le journal.'; exit 1 }
Write-Output 'M1 VALIDE : 18/18 attendus ci-dessus (13 unitaires + 5 intégration).'

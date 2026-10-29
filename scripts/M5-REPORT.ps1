#Requires -Version 5.1
<#
.SYNOPSIS
  M5-REPORT : agrege les journaux M5 (preflight, tests local/LAN, bench IA)
  en un rapport Markdown horodate. Lecture seule : ne relance aucun test.
  Compatible Windows PowerShell 5.1 (ASCII uniquement).
.USAGE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\M5-REPORT.ps1
  Sortie : bench-logs\M5-RAPPORT-<horodatage>.md (resume aussi en console).
#>
$ErrorActionPreference = 'Continue'
$ROOT = Split-Path -Parent $PSScriptRoot
$STAMP = Get-Date -Format 'yyyyMMdd-HHmmss'
$LOGDIR = Join-Path $ROOT 'bench-logs'
$OUT = Join-Path $LOGDIR ('M5-RAPPORT-' + $STAMP + '.md')
$rep = @()
function Add($m) { $script:rep += $m; Write-Host $m }

Add '# M5 — rapport de validation terrain'
Add ''
Add ("genere le $STAMP (scripts/M5-REPORT.ps1, agregation, aucun test relance)")
Add ''
Add '## 1. Preflight'
$pres = Get-ChildItem $LOGDIR -Filter 'm5-preflight-*.log' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 3
if (-not $pres) { Add '- NON EXECUTE : aucun journal m5-preflight-*.log' }
foreach ($f in $pres) {
  $ok = (Select-String -Path $f.FullName -Pattern '\[OK\]' -AllMatches).Matches.Count
  $ko = (Select-String -Path $f.FullName -Pattern '\[KO\]' -AllMatches).Matches.Count
  Add ('- ' + $f.Name + ' : ' + $ok + ' OK / ' + $ko + ' KO')
  foreach ($l in (Select-String -Path $f.FullName -Pattern '\[(KO|INFO)\].*' -AllMatches | Select-Object -ExpandProperty Line)) {
    Add ('  - ' + $l.Substring(0, [Math]::Min(220, $l.Length)))
  }
}
Add ''
Add '## 2. Tests mono-PC (processus separes)'
$runs = Get-ChildItem $LOGDIR -Filter 'm5-test-local-*.log' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 3
if (-not $runs) { Add '- NON EXECUTE : aucun journal m5-test-local-*.log (sandbox bloque listen, ou script jamais lance)' }
foreach ($f in $runs) {
  $txt = Get-Content $f.FullName -Raw
  $verdict = 'INCONNU'
  if ($txt -match 'M5-TEST-LOCAL REUSSI') { $verdict = '[FONCTIONNEL] M5-TEST-LOCAL REUSSI' }
  elseif ($txt -match 'ENVIRONNEMENT BLOQUE') { $verdict = 'NON EXECUTE (environnement bloque)' }
  elseif ($txt -match 'ECHEC|erreur|timeout') { $verdict = 'ECHEC (voir journal)' }
  Add ('- ' + $f.Name + ' : ' + $verdict)
  foreach ($pat in @('job j1 : outcome', 'job j2 : outcome', 'job j3 : outcome', 'REPRISE APRES PANNE', 'RECONNEXION PROUVEE', 'bench IA archive')) {
    $hit = Select-String -Path $f.FullName -Pattern ([regex]::Escape($pat)) | Select-Object -First 1
    if ($hit) { Add ('  - ' + $hit.Line.Substring(0, [Math]::Min(220, $hit.Line.Length))) }
  }
}
Add ''
Add '## 3. Pilote NeuroCore (zero appel Muse)'
$ncs = Get-ChildItem $LOGDIR -Filter 'm5nc-neurocore-*.log' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 3
if (-not $ncs) { Add '- NON EXECUTE : aucun journal m5nc-neurocore-*.log' }
foreach ($f in $ncs) {
  $txt = Get-Content $f.FullName -Raw
  $verdict = 'INCONNU'
  if ($txt -match 'M5-NEUROCORE REUSSI') { $verdict = '[FONCTIONNEL] M5-NEUROCORE REUSSI' }
  elseif ($txt -match 'ENVIRONNEMENT BLOQUE') { $verdict = 'NON EXECUTE (environnement bloque)' }
  Add ('- ' + $f.Name + ' : ' + $verdict)
  $gm = Select-String -Path $f.FullName -Pattern 'garde-muse' | Select-Object -First 1
  if ($gm) { Add ('  - ' + $gm.Line.Substring(0, [Math]::Min(220, $gm.Line.Length))) }
}
Add ''
Add '## 4. Tests LAN deux PC'
$lans = Get-ChildItem $LOGDIR -Filter 'm5-lan-*.log' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 4
if (-not $lans) { Add '- NON EXECUTE : aucun journal m5-lan-*.log (second PC requis + consentement)' }
foreach ($f in $lans) {
  $txt = Get-Content $f.FullName -Raw
  $verdict = 'INCONNU'
  if ($txt -match 'JOB DISTANT INTER-MACHINES EXACT') { $verdict = '[FONCTIONNEL] job distant inter-machines exact' }
  elseif ($txt -match 'ENVIRONNEMENT BLOQUE|Abandon') { $verdict = 'NON EXECUTE' }
  Add ('- ' + $f.Name + ' : ' + $verdict)
}
Add ''
Add '## 5. Volet IA reelle (bench-m4-backends)'
$benchs = Get-ChildItem $LOGDIR -Filter 'm4-backends-m5-*.json' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 2
if (-not $benchs) { Add '- NON EXECUTE : aucun m4-backends-m5-*.json (voir aussi bench-logs/m4-backends-20261026.json [M4])' }
foreach ($f in $benchs) {
  try {
    $b = Get-Content $f.FullName -Raw | ConvertFrom-Json
    Add ('- ' + $f.Name + ' : bench archive (lire EPs + erreurs dans le JSON, jamais de resume invente ici)')
  } catch { Add ('- ' + $f.Name + ' : JSON illisible') }
}
Add ''
Add '## 6. Limites et non execute'
Add '- Tout element sans journal ci-dessus est NON EXECUTE, pas echoue.'
Add '- Deux processus sur un PC prouvent une integration locale, pas un reseau multi-appareils.'
Add '- Voir docs/M5_LIMITATIONS.md pour le detail.'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines($OUT, $rep, $utf8NoBom)
Write-Host ("Rapport ecrit : $OUT")

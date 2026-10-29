#Requires -Version 5.1
<#
.SYNOPSIS
  M5-TEST-LOCAL : un PC, trois processus isoles (2 workers + coordinateur).
  Scenes : decouverte+auth+negociation, job batch-fib distant (force par
  --no-self), kill brutal d'un worker, reprise sans perte, reconnexion,
  puis volet IA reelle (bench-m4-backends : ORT cpu/dml, erreur 0).
  Compatible Windows PowerShell 5.1 (ASCII uniquement).
  N'expose rien hors loopback, ne modifie aucun reglage systeme.
  En sandbox Muse le listen est bloque (EACCES) : le script le detecte et
  rend un exit 2 explicite (ENVIRONNEMENT), pas un echec fonctionnel.
.USAGE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\M5-TEST-LOCAL.ps1
  Journaux : bench-logs\m5-test-local-<horodatage>.log + sorties .out.log.
  Exit 0 = reussi ; 1 = echec fonctionnel ; 2 = environnement bloque.
#>
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $PSScriptRoot
$STAMP = Get-Date -Format 'yyyyMMdd-HHmmss'
$LOGDIR = Join-Path $ROOT 'bench-logs'
New-Item -ItemType Directory -Force $LOGDIR | Out-Null
$WORK = Join-Path (Join-Path $ROOT 'mesh-compute/test') '.tmp-m5'
New-Item -ItemType Directory -Force $WORK | Out-Null
$LOG = Join-Path $LOGDIR ('m5-test-local-' + $STAMP + '.log')
$NODE = Join-Path $ROOT 'mesh-compute/bin/compute-node.js'
$DISC = '47901'

function Say($m) {
  $line = "[m5-local] $m"
  Write-Host $line
  Add-Content -Path $LOG -Value ((Get-Date -Format o) + ' ' + $line)
}
function Fail-Env($m) {
  $Global:JobFailed = $true
  Say ("ENVIRONNEMENT BLOQUE : " + $m)
  Say 'Conclusion : executer ce script dans un PowerShell ordinaire hors sandbox Muse.'
  exit 2
}
function Start-Worker($name, $port, $statusPort, $extra) {
  $out = Join-Path $LOGDIR ('m5-' + $name + '-' + $STAMP + '.out.log')
  $args = @($NODE, '--name', $name, '--port', "$port", '--status-port', "$statusPort",
    '--bind-host', '127.0.0.1', '--ephemeral', '--quiet', '--discovery-port', $DISC) + $extra
  $p = Start-Process -FilePath 'node' -ArgumentList $args -WorkingDirectory $WORK `
    -RedirectStandardOutput $out -RedirectStandardError ($out + '.err') -WindowStyle Hidden -PassThru
  Say ("processus $name demarre (pid " + $p.Id + ", tcp $port)")
  return @{ proc = $p; out = $out; name = $name; port = $port; statusPort = $statusPort }
}
function Check-EarlyDeath($h) {
  Start-Sleep -Seconds 3
  if ($h.proc.HasExited) {
    $txt = ''
    if (Test-Path $h.out) { $txt = (Get-Content $h.out -Raw -ErrorAction SilentlyContinue) + (Get-Content ($h.out + '.err') -Raw -ErrorAction SilentlyContinue) }
    if ($txt -match 'EACCES') { Fail-Env ("le worker " + $h.name + " meurt sur EACCES listen (sandbox Muse).") }
    throw ("le worker " + $h.name + " est mort prematurement : " + $txt.Substring(0, [Math]::Min(500, $txt.Length)))
  }
}
function Wait-Peers($statusPort, $want, $timeoutSec, $label) {
  $t0 = Get-Date
  $n = -1
  while (((Get-Date) - $t0).TotalSeconds -lt $timeoutSec) {
    try {
      $st = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $statusPort + "/status") -TimeoutSec 3
      $n = @($st.peers).Count
      if ($n -ge $want) { Say ("maillage $label : $n pair(s) (soi=" + $st.self.short + ")"); return $true }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  throw ("maillage $label : seulement $n pair(s), $want attendu(s)")
}
function Guess-Cause($txt, $err) {
  # Resume PROBABLE (le brut ci-dessus tranche, ce resume ne masque rien).
  if ($err -match 'Expected property name|in JSON at position') { return 'CAUSE PROBABLE : JSON des params deforme en argv (guillemets manges par Start-Process) -> utiliser --job-params-file (deja le cas : verifier le fichier .params.json).' }
  if (($txt + $err) -match 'EACCES') { return 'CAUSE PROBABLE : listen bloque (sandbox Muse ou port protege) -> executer hors sandbox.' }
  if (($txt + $err) -match 'EADDRINUSE|already in use') { return 'CAUSE PROBABLE : port deja occupe (coordinateur zombie d''un run precedent) -> tuer les node residuels (Get-Process node) puis relancer.' }
  if ($txt -match 'verdict-local: .*file muette') { return 'CAUSE PROBABLE : file muette cote moteur (aucun verdict reseau a temps) -> voir M5_FIELD_VALIDATION, fournir les .out.log.' }
  if ($txt -match '\[job-exit\] code=1') { return 'CAUSE PROBABLE : job execute mais verdict failed (voir la ligne [job] : no-capacity ? failed ?).' }
  return 'CAUSE INDETERMINEE : fournir au developpeur le .log principal + les .out.log et .out.log.err du job.'
}
function Run-Job($tag, $ns, $wantPeers) {
  # M5 : params via FICHIER (jamais de JSON en argv : Start-Process PS5.1
  # mange les guillemets nus -> "Expected property name..." prouve sur j1).
  $paramsFile = Join-Path $WORK ('m5-job-' + $tag + '.params.json')
  # UTF-8 SANS BOM explicite (Set-Content -Encoding utf8 ecrit un BOM en
  # PS5.1, que JSON.parse refuse : "Unexpected token" prouve sur j1).
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($paramsFile, ('{"ns":[' + ($ns -join ',') + ']}'), $utf8NoBom)
  $out = Join-Path $LOGDIR ('m5-job-' + $tag + '-' + $STAMP + '.out.log')
  $args = @($NODE, '--name', ('m5-c-' + $tag), '--port', '49203', '--status-port', '49303',
    '--bind-host', '127.0.0.1', '--ephemeral', '--quiet', '--discovery-port', $DISC,
    '--no-self', '--job', 'batch-fib', '--job-params-file', $paramsFile,
    '--submit-wait-peers', "$wantPeers", '--submit-delay-ms', '1000')
  Say ("job $tag : batch-fib ns=" + ($ns -join ','))
  $p = Start-Process -FilePath 'node' -ArgumentList $args -WorkingDirectory $WORK `
    -RedirectStandardOutput $out -RedirectStandardError ($out + '.err') -WindowStyle Hidden -PassThru
  $exited = $p.WaitForExit(120000)
  if (-not $exited) { try { $p.Kill() } catch {}; throw ("job $tag : timeout 120 s (coordinateur toujours vivant)") }
  $p.Refresh()
  $txt = Get-Content $out -Raw -ErrorAction SilentlyContinue
  if ($null -eq $txt) { $txt = '' }
  $err = Get-Content ($out + '.err') -Raw -ErrorAction SilentlyContinue
  if ($null -eq $err) { $err = '' }
  if ($txt -match 'EACCES') { Fail-Env 'EACCES listen pendant le job (sandbox Muse).' }
  # Code de sortie : source primaire = l'enfant lui-meme ([job-exit]),
  # $p.ExitCode n'est qu'un repli (vide/illisible en PS5.1 si mort precoce).
  $code = '(vide : mort avant verdict ? voir stderr)'
  $xe = [regex]::Match($txt, '\[job-exit\] code=(\d+)')
  if ($xe.Success) { $code = $xe.Groups[1].Value }
  else { try { $code = "$($p.ExitCode) (hote)" } catch { $code = '(illisible hote+enfant)' } }
  $m = [regex]::Match($txt, '\[job\] (\{.*\})')
  if (-not $m.Success) {
    Say ("DIAGNOSTIC job $tag : exit=$code, stdout=" + $txt.Length + " o, stderr=" + $err.Length + " o")
    Add-Content -Path $LOG -Value ("--- debut stdout $tag (tronque 2000) ---")
    Add-Content -Path $LOG -Value ($txt.Substring(0, [Math]::Min(2000, $txt.Length)))
    Add-Content -Path $LOG -Value ("--- debut stderr $tag (tronque 2000) ---")
    Add-Content -Path $LOG -Value ($err.Substring(0, [Math]::Min(2000, $err.Length)))
    Say (Guess-Cause $txt $err)
    throw ("job $tag : aucune ligne [job] dans la sortie (exit=$code, voir diagnostic ci-dessus)")
  }
  Say ("job $tag : code de sortie coordinateur=" + $code)
  $job = $m.Groups[1].Value | ConvertFrom-Json
  Say ("job $tag : outcome=" + $job.outcome + " valeur=" + ($job.value -join ','))
  Add-Content -Path $LOG -Value ("[job-" + $tag + "] " + $m.Groups[1].Value)
  return $job
}
function Check-Job($job, $tag, $expect) {
  if ($job.outcome -ne 'done') { throw ("job $tag non done : " + $job.outcome) }
  $got = ($job.value -join ',')
  if ($got -ne $expect) { throw ("job $tag valeur inexacte : $got (attendu $expect)") }
  Say ("job $tag EXACT ($got)")
}

$w1 = $null; $w2 = $null
$Global:JobFailed = $false
try {
  $w1 = Start-Worker 'm5-w1' 49201 49301 @()
  $w2 = Start-Worker 'm5-w2' 49202 49302 @()
  Check-EarlyDeath $w1
  Check-EarlyDeath $w2
  Say 'decouverte+auth+negociation : 2 workers en vie, attente maillage'
  Wait-Peers 49301 1 30 'w1'
  # Scene 1 : job distant a 2 workers (coordinateur exclu par --no-self).
  $j1 = Run-Job 'j1' @(20, 25, 30) 2
  Check-Job $j1 'j1' '6765,75025,832040'
  # Scene 2 : PANNE - kill brutal de w2, reprise sans perte sur w1 seul.
  Say 'PANNE : kill brutal de m5-w2'
  $w2.proc.Kill()
  Start-Sleep -Seconds 6
  $j2 = Run-Job 'j2' @(20, 25) 1
  Check-Job $j2 'j2' '6765,75025'
  Say 'REPRISE APRES PANNE PROUVEE (sans perte, valeurs exactes)'
  # Scene 3 : RECONNEXION - relance w2, job a 2 workers.
  $w2 = Start-Worker 'm5-w2' 49202 49302 @()
  Check-EarlyDeath $w2
  Wait-Peers 49302 1 30 'w2-relance'
  $j3 = Run-Job 'j3' @(30) 2
  Check-Job $j3 'j3' '832040'
  Say 'RECONNEXION PROUVEE'
  # Scene 4 : IA REELLE - inférences Gemm ORT par backend declare.
  Say 'volet IA : bench-m4-backends (ORT reel, 5 repetitions)'
  $benchOut = Join-Path $LOGDIR ('m4-backends-m5-' + $STAMP + '.json')
  & node (Join-Path $ROOT 'scripts/bench-m4-backends.js') --reps 5 --out $benchOut 2>&1 | Tee-Object -FilePath $LOG -Append | Write-Output
  if ($LASTEXITCODE -ne 0) { throw 'bench-m4-backends en echec' }
  Say ("bench IA archive : $benchOut")
  Say 'M5-TEST-LOCAL REUSSI'
} catch {
  $Global:JobFailed = $true
  throw
} finally {
  foreach ($h in @($w1, $w2)) {
    if ($h -and $h.proc -and -not $h.proc.HasExited) { try { $h.proc.Kill() } catch {} }
  }
  if ($Global:JobFailed) {
    # Echec : on CONSERVE tout pour analyse (instruction M5 n.10).
    Say 'ECHEC : fichiers conserves pour analyse :'
    Get-ChildItem $LOGDIR -Filter ('m5-*' + $STAMP + '*') -ErrorAction SilentlyContinue | ForEach-Object { Say ('  - ' + $_.FullName) }
    Get-ChildItem $WORK -Filter 'data-m5-*' -ErrorAction SilentlyContinue | ForEach-Object { Say ('  - ' + $_.FullName + ' (conserve, a supprimer apres analyse)') }
    Get-ChildItem $WORK -Filter 'm5-job-*.params.json' -ErrorAction SilentlyContinue | ForEach-Object { Say ('  - ' + $_.FullName) }
  } else {
    Get-ChildItem $WORK -Filter 'data-m5-*' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem $WORK -Filter 'm5-job-*.params.json' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Say 'processus nettoyes, fichiers du test supprimes (succes)'
  }
}

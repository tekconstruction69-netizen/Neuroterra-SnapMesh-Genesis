#Requires -Version 5.1
<#
  Demo bout-en-bout Genesis (P9) : requete -> fragments -> placement ->
  execution -> verification -> reponse, via l'app + 1 noeud compute,
  puis PANNE (kill executant) -> relance -> reprise prouvee, puis STOP.
  Boucle locale uniquement, aucun reseau externe, nettoyage en fin.
  Preuves : verdicts exacts, empreinte finale, faisceau, graphe, jeton,
  reprise apres panne.

    powershell -ExecutionPolicy Bypass -File scripts/demo-bout-en-bout.ps1
#>
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $PSScriptRoot
$APP_PORT = 48797
$BASE = "http://127.0.0.1:$APP_PORT"
$STAMP = Get-Date -Format 'yyyyMMdd-HHmmss'
$LOG = Join-Path (Join-Path $ROOT 'bench-logs') ('demo-bout-en-bout-' + $STAMP + '.log')
$APP_OUT = Join-Path (Join-Path $ROOT 'bench-logs') ('demo-app-' + $STAMP + '.out.log')

function Say($m) {
  $line = "[demo] $m"
  Write-Host $line
  Add-Content -Path $LOG -Value ((Get-Date -Format o) + ' ' + $line)
}
function Wait-Http($url, $timeoutSec, $label) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $timeoutSec) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  throw "timeout : $label"
}
function Wait-Token($path, $timeoutSec) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $timeoutSec) {
    if (Test-Path $path) {
      $m = Select-String -Path $path -Pattern '\[auth\] jeton local : ([0-9a-f]{48})' | Select-Object -Last 1
      if ($m) { return $m.Matches[0].Groups[1].Value }
    }
    Start-Sleep -Milliseconds 500
  }
  throw 'timeout : jeton local'
}
function Post($url, $body, $token) {
  return Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json' `
    -Headers @{ 'X-Genesis-Token' = $token } -Body $body
}
function Start-Exec($tag) {
  $p = Start-Process -FilePath 'node' -ArgumentList @(
    (Join-Path $ROOT 'mesh-compute/bin/compute-node.js'),
    '--name', 'demo-exec', '--port', '48384', '--status-port', '48884',
    '--ephemeral', '--quiet', '--discovery-port', '47862'
  ) -WorkingDirectory (Join-Path $ROOT 'mesh-compute/test/.tmp-int') -PassThru
  Say "executant demarre ($tag, pid $($p.Id))"
  return $p
}

$exec = $null
$app = $null
try {
  New-Item -ItemType Directory -Force (Join-Path $ROOT 'bench-logs') | Out-Null
  $exec = Start-Exec 'phase-1'
  Say 'demarrage app Genesis (--ephemeral)'
  $app = Start-Process -FilePath 'node' -ArgumentList @(
    (Join-Path $ROOT 'mesh-app/server.js'),
    '--port', "$APP_PORT", '--mesh-port', '48383', '--status-port', '48483',
    '--ephemeral', '--discovery-port', '47862'
  ) -WorkingDirectory (Join-Path $ROOT 'mesh-app/test') -RedirectStandardOutput $APP_OUT -PassThru
  Wait-Http "$BASE/api/state" 30 'app'
  $TOKEN = Wait-Token $APP_OUT 30
  Say 'app en ligne, jeton local lu (POST proteges)'
  $startRes = Post "$BASE/api/start" '{"consent": true}' $TOKEN
  Say ('START : ' + $startRes.state)
  $t0 = Get-Date
  $peerOk = $false
  while (((Get-Date) - $t0).TotalSeconds -lt 30 -and -not $peerOk) {
    $st = Invoke-RestMethod -Uri "$BASE/api/state"
    $firstPeer = $st.caps.peers | Select-Object -First 1
    if ($firstPeer -and $firstPeer.sessionVerified) { $peerOk = $true }
    Start-Sleep -Milliseconds 500
  }
  if (-not $peerOk) { throw 'pair non verifie' }
  Say 'pair maille a session verifiee'
  Say 'soumission job batch-fib [20,25,30]'
  $job = Post "$BASE/api/job" '{"preset":"batch-fib","params":{"ns":[20,25,30]}}' $TOKEN
  Say ('verdict : ' + $job.outcome + ' valeur=' + ($job.value -join ','))
  Say ('empreinte finale : ' + $job.verification.finalHash)
  $fragTxt = ($job.fragments | ForEach-Object { $_.id + '=' + $_.outcome + '@' + (($_.executedBy | Select-Object -First 1)) }) -join ' '
  Say ('fragments : ' + $fragTxt)
  if ($job.outcome -ne 'done') { throw 'job1 non done' }
  if (($job.value -join ',') -ne '6765,75025,832040') { throw 'valeur inexacte' }
  $st2 = Invoke-RestMethod -Uri "$BASE/api/state"
  Say ('graphe : ' + $st2.graph.nodes.Count + ' noeud(s), ' + $st2.graph.links.Count + ' lien(s)')
  Say 'PANNE : kill brutal de l''executant'
  $exec.Kill()
  Start-Sleep -Seconds 4
  $exec = Start-Exec 'phase-2 (relance)'
  Say 'attente re-maillage (15 s)'
  Start-Sleep -Seconds 15
  Say 'soumission job batch-fib [20,25] apres panne'
  $job2 = Post "$BASE/api/job" '{"preset":"batch-fib","params":{"ns":[20,25]}}' $TOKEN
  Say ('verdict reprise : ' + $job2.outcome + ' valeur=' + ($job2.value -join ','))
  if ($job2.outcome -ne 'done') { throw 'reprise echouee' }
  if (($job2.value -join ',') -ne '6765,75025') { throw 'valeur reprise inexacte' }
  Say 'REPRISE APRES PANNE PROUVEE'
  $stopRes = Post "$BASE/api/stop" '{"reason":"fin demo"}' $TOKEN
  Say ('STOP : ' + $stopRes.stopped)
  Say 'DEMO REUSSIE'
} finally {
  foreach ($p in @($exec, $app)) {
    if ($p -and -not $p.HasExited) {
      try { $p.Kill() } catch {}
    }
  }
  Say 'processus nettoyes'
}

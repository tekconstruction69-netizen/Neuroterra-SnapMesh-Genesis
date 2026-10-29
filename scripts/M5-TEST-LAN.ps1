#Requires -Version 5.1
<#
.SYNOPSIS
  M5-TEST-LAN : test entre deux PC Windows du meme LAN prive.
  Role worker : rejoint le coordinateur et execute des ops autorisees.
  Role coordinateur : soumet un job batch-fib distant et verifie l'exactitude.
  Ne modifie JAMAIS le pare-feu ni aucun reglage systeme. Si Windows propose
  un acces reseau : accepter uniquement les reseaux PRIVES, jamais publics.
  Procedure detaillee : scripts\TEST-LAN-DEUX-PC.md (M1) + docs\M5_LAN_TEST_PROCEDURE.md.
  Compatible Windows PowerShell 5.1 (ASCII uniquement).
.USAGE (PowerShell ordinaire, hors sandbox Muse)
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\M5-TEST-LAN.ps1 -Role worker -Peer 192.168.1.10:49210
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\M5-TEST-LAN.ps1 -Role coordinateur
  Exit 0 = reussi ; 1 = echec ; 2 = environnement bloque ou sans consentement.
  FENETRES : le worker tourne dans sa propre console (STOP = Ctrl+C dedans,
  BYE gracieux). Le coordinateur est one-shot (arret propre + code).
  SECURITE : pare-feu jamais modifie ; si Windows propose un acces, accepter
  uniquement les reseaux PRIVES. --ephemeral : aucune cle persistee.
  Bornes actives : 2 workers max, 64 Mo, 5 s/op (conservateur : thermique
  et batterie non mesurees en Node pur -> petits jobs uniquement).
#>
param(
  [ValidateSet('worker', 'coordinateur')]
  [string]$Role = 'worker',
  [string]$Peer = '',
  [string]$BindHost = '0.0.0.0',
  [int]$Port = 49210,
  [int]$StatusPort = 49310,
  [int]$DiscoveryPort = 47902
)
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $PSScriptRoot
$STAMP = Get-Date -Format 'yyyyMMdd-HHmmss'
$LOGDIR = Join-Path $ROOT 'bench-logs'
New-Item -ItemType Directory -Force $LOGDIR | Out-Null
$WORK = Join-Path (Join-Path $ROOT 'mesh-compute/test') '.tmp-m5lan'
New-Item -ItemType Directory -Force $WORK | Out-Null
$LOG = Join-Path $LOGDIR ('m5-lan-' + $Role + '-' + $STAMP + '.log')
$NODE = Join-Path $ROOT 'mesh-compute/bin/compute-node.js'

function Say($m) {
  $line = "[m5-lan] $m"
  Write-Host $line
  Add-Content -Path $LOG -Value ((Get-Date -Format o) + ' ' + $line)
}

# 1. Consentement explicite des deux operateurs (exige).
Say 'Test inter-machines : deux PC du meme LAN prive, aucun reseau public/invite.'
Say 'Le pare-feu ne sera JAMAIS modifie par ce script.'
$cons = Read-Host 'Les deux operateurs acceptent le test (reseau prive, logs locaux) ? [OUI/non]'
if ($cons -ne 'OUI') { Say 'Sans consentement explicite : abandon (exit 2).'; exit 2 }

# 2. Pre-requis : preflight integre (reutilise, jamais duplique).
Say 'etape 0 : preflight M5 (diagnostic, lecture seule)'
& (Join-Path $PSScriptRoot 'M5-PREFLIGHT.ps1') | ForEach-Object { Say ('  [preflight] ' + $_) }
$nv = (node --version 2>&1).ToString().Trim()
Say ("node $nv")
try {
  $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $l.Start(); $l.Stop()
  Say 'listen loopback OK'
} catch { Say 'listen BLOQUE : test LAN impossible ici (sandbox ?). Abandon (exit 2).'; exit 2 }
try {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object -ExpandProperty IPAddress
  Say ('IP locales : ' + ($ips -join ', ') + ' (communiquer la privee a l''autre operateur)')
} catch { Say 'IP locales illisibles : utiliser ipconfig et noter l''IPv4 privee.' }

if ($Role -eq 'worker' -and -not $Peer) {
  Say 'Role worker exige -Peer <ip-du-coordinateur>:49210 (ex. -Peer 192.168.1.10:49210). Abandon (exit 2).'
  exit 2
}

# 3. Lancement selon le role.
$name = 'm5-lan-worker'
$extra = @()
if ($Role -eq 'worker') {
  $name = 'm5-lan-worker'
  $extra = @('--peers', $Peer)
} else {
  $name = 'm5-lan-coord'
  # Params via FICHIER (meme cause argv qu'en local : guillemets manges).
  $paramsFile = Join-Path $WORK 'm5-lan.params.json'
  # UTF-8 SANS BOM explicite (cf. M5-TEST-LOCAL : BOM refuse par JSON.parse).
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($paramsFile, '{"ns":[20,25,30]}', $utf8NoBom)
  $extra = @('--no-self', '--job', 'batch-fib', '--job-params-file', $paramsFile,
    '--submit-wait-peers', '1', '--submit-delay-ms', '2000')
  if ($Peer) { $extra = @('--peers', $Peer) + $extra }
}
$out = Join-Path $LOGDIR ('m5-lan-' + $Role + '-' + $STAMP + '.out.log')
# Bornes sandbox EXPLICITES (mêmes que les défauts, prouvées dans le journal).
$args = @($NODE, '--name', $name, '--port', "$Port", '--status-port', "$StatusPort",
  '--bind-host', $BindHost, '--ephemeral', '--discovery-port', "$DiscoveryPort",
  '--sandbox-max-workers', '2', '--sandbox-timeout-ms', '5000', '--sandbox-mem-mb', '64') + $extra
Say ("lancement $name (port $Port, bind $BindHost)")
Say 'plafonds : 2 workers, 64 Mo, 5 s/op, ops whitelisted uniquement, --ephemeral'
$p = Start-Process -FilePath 'node' -ArgumentList $args -WorkingDirectory $WORK `
  -RedirectStandardOutput $out -RedirectStandardError ($out + '.err') -PassThru

try {
  if ($Role -eq 'worker') {
    Say 'Worker en ligne (fenetre console dediee). Laisser tourner : le coordinateur va soumettre un job.'
    Say 'Scenes guidees ensuite : (a) job distant, (b) DECONNEXION physique (couper le reseau 10 s),'
    Say '(c) reactivation et reconnexion, (d) STOP = Ctrl+C DANS LA FENETRE DU WORKER (BYE gracieux).'
    Say 'Ce script attend ici jusqu''a l''arret du worker.'
    $p.WaitForExit()
    Say 'Worker arrete.'
  } else {
    if (-not $p.WaitForExit(120000)) { try { $p.Kill() } catch {}; throw 'coordinateur : timeout 120 s' }
    $txt = Get-Content $out -Raw -ErrorAction SilentlyContinue
    $m = [regex]::Match($txt, '\[job\] (\{.*\})')
    if (-not $m.Success) { throw 'aucune ligne [job] (pair injoignable ? pare-feu ?)' }
    $job = $m.Groups[1].Value | ConvertFrom-Json
    Say ('job distant : outcome=' + $job.outcome + ' valeur=' + ($job.value -join ','))
    Add-Content -Path $LOG -Value ('[job-lan] ' + $m.Groups[1].Value)
    if ($job.outcome -ne 'done') { throw ('job non done : ' + $job.outcome) }
    if (($job.value -join ',') -ne '6765,75025,832040') { throw 'valeur inexacte' }
    Say 'JOB DISTANT INTER-MACHINES EXACT'
    # Preuve d'authentification : pairs à session vérifiée + caps + RTT.
    try {
      $st = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $StatusPort + "/status") -TimeoutSec 5
      foreach ($peer in @($st.peers)) {
        $cpu = $peer.caps.cpu.threads + 'x ' + $peer.caps.cpu.arch
        Say ('pair : ' + $peer.name + ' sessionVerified=' + $peer.sessionVerified + ' cpu=' + $cpu + ' rttMs=' + $peer.caps.net.rttMs)
      }
      Add-Content -Path $LOG -Value ('[peers-lan] ' + ($st.peers | ConvertTo-Json -Compress -Depth 6))
    } catch { Say 'peers /status illisible (noeud deja arrete ?)' }
    Say 'Scenes suivantes : tuer le worker (Ctrl+C cote worker), relancer ce script (reprise),'
    Say 'puis deconnecter physiquement 10 s et observer la reaffectation dans les logs.'
    Say 'Preuve chiffrement : sur le PC WORKER, chercher "[exec]" avec "chiffre=1" dans son .out.log.'
  }
  $script:LanFailed = $false
} catch {
  $script:LanFailed = $true
  throw
} finally {
  if (-not $p.HasExited) { try { $p.Kill() } catch {} }
  if ($script:LanFailed) {
    Say 'ECHEC : fichiers conserves pour analyse :'
    Get-ChildItem $LOGDIR -Filter ('m5-lan-*' + $STAMP + '*') -ErrorAction SilentlyContinue | ForEach-Object { Say ('  - ' + $_.FullName) }
    Get-ChildItem $WORK -Filter 'data-m5-*' -ErrorAction SilentlyContinue | ForEach-Object { Say ('  - ' + $_.FullName + ' (conserve)') }
  } else {
    Get-ChildItem $WORK -Filter 'data-m5-*' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  }
  Say ('journal : ' + $LOG)
}

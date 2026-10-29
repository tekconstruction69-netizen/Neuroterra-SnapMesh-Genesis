#Requires -Version 5.1
<#
.SYNOPSIS
  M5-PREFLIGHT : diagnostic pre-test SnapMesh Genesis (lecture seule).
  Verifie Node.js, dependances, ports, interfaces reseau, backend ORT et
  absence d'appels Muse obligatoires. NE MODIFIE RIEN : aucun changement
  pare-feu, aucun listen persistant, aucune installation.
  Compatible Windows PowerShell 5.1 (aucun accent, aucune syntaxe PS7).
.USAGE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\M5-PREFLIGHT.ps1
  Sortie : bench-logs\m5-preflight-<horodatage>.log (+ resume console).
  Code de sortie 0 = preflight termine (meme si des points sont KO).
#>
$ErrorActionPreference = 'Continue'
$ROOT = Split-Path -Parent $PSScriptRoot
$STAMP = Get-Date -Format 'yyyyMMdd-HHmmss'
$LOGDIR = Join-Path $ROOT 'bench-logs'
New-Item -ItemType Directory -Force $LOGDIR | Out-Null
$LOG = Join-Path $LOGDIR ('m5-preflight-' + $STAMP + '.log')
$Global:KO = 0

function Say($level, $msg) {
  $line = "[preflight][$level] $msg"
  Write-Host $line
  Add-Content -Path $LOG -Value ((Get-Date -Format o) + ' ' + $line)
  if ($level -eq 'KO') { $Global:KO++ }
}
function Check($name, $ok, $detail) {
  if ($ok) { Say 'OK' ("$name : $detail") }
  else { Say 'KO' ("$name : $detail") }
}

Say 'INFO' "racine=$ROOT stamp=$STAMP"

# 1. Node.js / npm (sources officielles attendues, binaires deja installes).
try {
  $nv = (node --version 2>&1).ToString().Trim()
  $npmv = (npm --version 2>&1).ToString().Trim()
  $major = [int](($nv -replace '^v','') -split '\.')[0]
  Check 'node' ($major -ge 18) "version $nv (requis >= 18), npm $npmv"
} catch {
  Check 'node' $false "node introuvable dans PATH ($_) - installer depuis https://nodejs.org"
}

# 2. Dependances workspace (node_modules par paquet ; jamais d'install ici).
$pkgs = @('mesh-net', 'mesh-compute', 'nt-compat', 'neurocore')
foreach ($p in $pkgs) {
  $nm = Join-Path (Join-Path $ROOT $p) 'node_modules'
  $ok = Test-Path $nm
  $pkgJson = Join-Path (Join-Path $ROOT $p) 'package.json'
  $needsDeps = $true
  try {
    $pkg = Get-Content $pkgJson -Raw | ConvertFrom-Json
    $needsDeps = ($null -ne $pkg.dependencies) -or ($null -ne $pkg.optionalDependencies)
  } catch {}
  if ($ok) { $detail = 'dossier node_modules present' }
  elseif (-not $needsDeps) { $ok = $true; $detail = 'pas de node_modules mais aucune dependance declaree (OK)' }
  else { $detail = 'dossier node_modules ABSENT (npm install dans ' + $p + ')' }
  Check ("deps/$p") $ok $detail
}
$link = Join-Path (Join-Path (Join-Path $ROOT 'mesh-compute') 'node_modules') 'snapmesh-mesh-net'
$lok = Test-Path $link
if ($lok) { $ld = 'lien snapmesh-mesh-net present' } else { $ld = 'lien snapmesh-mesh-net ABSENT' }
Check 'deps/mesh-compute/link' $lok $ld

# 3. Backend ORT reel (requis pour le volet IA M5 section 5).
$ortPkg = Join-Path (Join-Path (Join-Path $ROOT 'nt-compat') 'node_modules') 'onnxruntime-node/package.json'
if (Test-Path $ortPkg) {
  $ver = (Get-Content $ortPkg -Raw | ConvertFrom-Json).version
  Check 'ort' $true "onnxruntime-node present (version $ver)"
} else {
  Check 'ort' $false 'onnxruntime-node ABSENT dans nt-compat/node_modules - volet IA M5 impossible sans install'
}

# 4. Ports M5 libres (test connexion TCP, pas de listen : ne declenche rien).
$ports = @(49201, 49202, 49203, 49301, 49302, 49303, 49210, 49310, 49401, 49402, 49403)
foreach ($pt in $ports) {
  $busy = $false
  try {
    $c = New-Object Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $pt, $null, $null)
    if ($iar.AsyncWaitHandle.WaitOne(400)) { $c.EndConnect($iar); $busy = $true }
    $c.Close()
  } catch {}
  if ($busy) { Check ("port/$pt") $false 'OCCUPE (conflit possible)' }
  else { Check ("port/$pt") $true 'libre' }
}

# 5. Diagnostic listen() : le sandbox Muse bloque EACCES. Hors sandbox ce
#    point doit etre OK, sinon aucun test reseau M5 n'est possible.
$listenOk = $false
$listenDetail = ''
try {
  $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $l.Start()
  $ep = $l.LocalEndpoint.ToString()
  $l.Stop()
  $listenOk = $true
  $listenDetail = "listen loopback OK ($ep)"
} catch {
  $listenDetail = 'listen BLOQUE (' + $_.Exception.Message + ') - si sandbox Muse : normal, executer hors sandbox'
}
Check 'listen' $listenOk $listenDetail

# 6. Interfaces reseau (pour le test LAN : il faut une IP privee).
try {
  $all = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -ne '127.0.0.1' }
  $ips = @($all | Select-Object -ExpandProperty IPAddress)
  $priv = @($ips | Where-Object { $_ -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' })
  if ($priv.Count -gt 0) { Check 'lan' $true ('IP privee(s) : ' + ($priv -join ', ') + ' (toutes : ' + ($ips -join ', ') + ')') }
  else { Check 'lan' $false ('aucune IP privee (vues : ' + ($ips -join ', ') + ') - test LAN impossible') }
} catch {
  Check 'lan' $false 'inventaire interfaces impossible - verifier ipconfig manuellement'
}

# 7. Garde NeuroCore : aucune cle Muse requise au runtime (les adaptateurs
#    Muse restent optionnels et hors chemin d'execution).
$museVars = @('MUSE_API_URL', 'MUSE_API_KEY', 'MUSE_MODEL') | Where-Object { [Environment]::GetEnvironmentVariable($_) }
if ($museVars) { Say 'INFO' ('variables Muse presentes mais INUTILES au runtime NeuroCore : ' + ($museVars -join ', ')) }
else { Say 'OK' 'aucune variable MUSE_* : NeuroCore tourne sans Muse par construction' }

# 8. Pare-feu : rappel uniquement, JAMAIS modifie par ce script.
Say 'INFO' 'pare-feu inchange (ce script ne touche a aucun reglage). Si Windows propose un acces reseau : accepter uniquement les reseaux PRIVES, jamais publics.'

Say 'INFO' ('preflight termine : ' + $Global:KO + ' point(s) KO - journal ' + $LOG)
exit 0

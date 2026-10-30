#Requires -Version 5.1
<#
.SYNOPSIS
  Sonde Wi-Fi Direct (LECTURE SEULE) pour SnapMesh Direct.
  Ne modifie AUCUN reglage : ni activation, ni appairage, ni hotspot.
  Ecrit un objet JSON sur la sortie standard.
  Exit 0 = sonde terminee ; 2 = environnement bloque.
#>
$ErrorActionPreference = 'SilentlyContinue'
function Probe {
  $adapters = @()
  try {
    $nics = Get-NetAdapter | Where-Object { $_.MediaType -match '802.11' -or $_.Name -match 'Wi-Fi|Wireless|Sans fil' }
    foreach ($n in $nics) {
      $adapters += @{ name = $n.Name; status = "$($n.Status)"; mac = "$($n.MacAddress)" }
    }
  } catch { $adapters = @() }
  $drv = @{}
  $lines = @()
  try { $lines = netsh wlan show drivers } catch { $lines = @() }
  $text = ($lines -join "`n")
  $m = [regex]::Match($text, '(?m)^\s*Nom de l.interface\s*:\s*(.+?)\s*$|(?m)^\s*Interface name\s*:\s*(.+?)\s*$')
  if ($m.Success) {
    $iname = ($m.Groups[1].Value + $m.Groups[2].Value).Trim()
    if ($iname -ne '') { $drv['interface'] = $iname }
  }
  $drv['wirelessDisplay'] = $text -match 'Affichage sans fil pris en charge\s*:\s*Oui|Wireless Display Supported\s*:\s*Yes'
  $drv['wifiDirectDevice'] = $text -match 'Wi-Fi Direct Device\s*:\s*Available|Peripherique Wi-Fi Direct\s*:\s*Disponible'
  $direct = 'non-confirme'
  if ($drv['wifiDirectDevice']) { $direct = 'confirme-pilote' }
  elseif ($drv['wirelessDisplay']) { $direct = 'probable-miracast' }
  $obj = @{
    v = 1
    adapters = $adapters
    driver = $drv
    wifiDirect = $direct
    note = 'Lecture seule. Aucun reglage modifie. Miracast suggere un support Wi-Fi Direct mais ne le prouve pas : test d appairage requis.'
  }
  $obj | ConvertTo-Json -Depth 4 -Compress
}
try { Probe } catch { Write-Host '{"v":1,"error":"sonde-bloquee"}'; exit 2 }
exit 0

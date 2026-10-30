#Requires -Version 5.1
<#
.SYNOPSIS
  Enumeration Wi-Fi Direct via WinRT (LECTURE SEULE, aucun appairage).
  Exit 0 = enumeration terminee (meme si 0 appareil) ; 2 = API inaccessible.
#>
$ErrorActionPreference = 'SilentlyContinue'
try {
  [void][Windows.Devices.WiFiDirect.WiFiDirectDevice, Windows.Devices.WiFiDirect, ContentType=WindowsRuntime]
  [void][Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType=WindowsRuntime]
} catch {
  Write-Host '{"v":1,"winrt":"inaccessible","devices":[]}'
  exit 2
}
$sel = [Windows.Devices.WiFiDirect.WiFiDirectDevice]::GetDeviceSelector()
$names = @()
try {
  $op = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel)
  $op.AsTask().Wait(15000) | Out-Null
  foreach ($d in $op.GetResults()) { $names += @{ name = "$($d.Name)"; enabled = "$($d.IsEnabled)" } }
  $winrt = 'accessible'
} catch {
  $winrt = 'enumeration-refusee'
}
@{ v = 1; winrt = $winrt; selector = "$sel"; devices = $names } | ConvertTo-Json -Depth 4 -Compress
exit 0

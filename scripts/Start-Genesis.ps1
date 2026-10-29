#Requires -Version 5.1
<#
.SYNOPSIS
  Start-Genesis : lance l'application locale Neuroterra Genesis
  (serveur de boucle 127.0.0.1 uniquement) et ouvre le navigateur.
  Aucun port public, aucun service installe. STOP = bouton dans
  l'interface ou fermeture de cette fenetre (Ctrl+C).
  Exit 0 = arret propre ; 1 = echec ; 2 = Node absent.
#>
param([int]$Port = 48700)
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $PSScriptRoot
try { $null = (node --version 2>&1) } catch { Write-Host '[genesis] Node.js introuvable (exit 2).'; exit 2 }
$url = "http://127.0.0.1:$Port/"
Write-Host "[genesis] Application locale : $url (START/STOP et NT-ID dans la page)"
Write-Host '[genesis] Fermer cette fenetre ou Ctrl+C arrete le serveur local.'
Start-Process $url
& node (Join-Path $ROOT 'mesh-app/server.js') --port "$Port"
if ($LASTEXITCODE -eq 0) { exit 0 } else { exit 1 }

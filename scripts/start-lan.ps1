$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$nodeBin = "C:\Users\AI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$localBin = Join-Path $root "node_modules\.bin"

$env:Path = "$nodeBin;$localBin;$env:Path"
$env:NODE_OPTIONS = "--max-old-space-size=4096"

Set-Location $root

$busyPorts = netstat -ano | Select-String ":(5173|5174)\s+.*LISTENING"
if ($busyPorts) {
  Write-Host "Port 5173 or 5174 is already in use. Stop the existing Grocery Getter server first."
  $busyPorts
  exit 1
}

$lanIp = ipconfig |
  Select-String "IPv4" |
  ForEach-Object { if ($_.Line -match "(\d+\.\d+\.\d+\.\d+)") { $Matches[1] } } |
  Where-Object { $_ -notlike "127.*" -and $_ -notlike "169.254.*" } |
  Select-Object -First 1

Write-Host "Starting Grocery Getter from $root"
Write-Host "Node: $(Get-Command node | Select-Object -ExpandProperty Source)"
Write-Host "Local URL: http://localhost:5173/"
if ($lanIp) {
  Write-Host "LAN URL: http://$lanIp:5173/"
}

node .\node_modules\concurrently\dist\bin\concurrently.js `
  "tsx watch server/index.ts" `
  "vite --config vite.lan.config.mjs --configLoader runner"

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$localBin = Join-Path $root "node_modules\.bin"
$codexNodeBin = "C:\Users\AI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"

if (Test-Path $codexNodeBin) {
  $env:Path = "$codexNodeBin;$localBin;$env:Path"
} else {
  $env:Path = "$localBin;$env:Path"
}
$env:NODE_OPTIONS = "--max-old-space-size=4096"

Set-Location $root

$busyPorts = netstat -ano | Select-String ":(5173|5174)\s+.*LISTENING"
if ($busyPorts) {
  Write-Host "Port 5173 or 5174 is already in use. Stop the existing Grocery Getter server first."
  $busyPorts
  exit 1
}

$ipv4Addresses = ipconfig |
  Select-String "IPv4" |
  ForEach-Object { if ($_.Line -match "(\d+\.\d+\.\d+\.\d+)") { $Matches[1] } } |
  Where-Object { $_ -notlike "127.*" -and $_ -notlike "169.254.*" }

$tailScaleIp = $ipv4Addresses |
  Where-Object {
    $parts = $_.Split(".") | ForEach-Object { [int]$_ }
    $parts[0] -eq 100 -and $parts[1] -ge 64 -and $parts[1] -le 127
  } |
  Select-Object -First 1

$lanIp = $ipv4Addresses |
  Where-Object { $_ -ne $tailScaleIp } |
  Select-Object -First 1

Write-Host "Starting Grocery Getter from $root"
Write-Host "Node: $(Get-Command node | Select-Object -ExpandProperty Source)"
Write-Host "Local URL: http://localhost:5173/"
if ($lanIp) {
  Write-Host "LAN URL: http://${lanIp}:5173/"
}
if ($tailScaleIp) {
  Write-Host "Tailscale URL: http://${tailScaleIp}:5173/"
}

node .\node_modules\concurrently\dist\bin\concurrently.js `
  "tsx watch server/index.ts" `
  "vite --config vite.lan.config.mjs --configLoader runner"

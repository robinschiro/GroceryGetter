$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error "Docker is not available on PATH. Start Docker Desktop and try again."
}

Write-Host "Starting Grocery Getter with Docker Compose Watch from $root"
Write-Host "Local URL: http://localhost:5173/"

& docker compose -f compose.dev.yaml up --build --watch
exit $LASTEXITCODE

[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$GitArguments
)

$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path $PSScriptRoot -Parent
$manifestPath = Join-Path $workspaceRoot ".codex-git-command.json"
$safeDirectory = $workspaceRoot.Replace("\", "/")
$gitCommand = Get-Command git -ErrorAction Stop
$gitExe = $gitCommand.Source

$manifestMode = $GitArguments.Count -eq 0

try {
  if ($manifestMode) {
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
      throw "Missing $manifestPath. Create it with an arguments array."
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifestArguments = @($manifest.arguments)
    if ($manifestArguments.Count -eq 0) {
      throw "arguments must contain at least one Git argument."
    }

    $GitArguments = @(
      foreach ($argumentValue in $manifestArguments) {
        $argument = [string]$argumentValue
        if ([string]::IsNullOrWhiteSpace($argument)) {
          throw "arguments cannot contain empty values."
        }
        if ($argument.Contains("`0") -or $argument.Contains("`r") -or $argument.Contains("`n")) {
          throw "arguments cannot contain nulls or newlines."
        }
        $argument
      }
    )
  }

  & $gitExe -c "safe.directory=$safeDirectory" -C $workspaceRoot @GitArguments
  $gitExitCode = $LASTEXITCODE
} finally {
  if ($manifestMode) {
    Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
  }
}

exit $gitExitCode

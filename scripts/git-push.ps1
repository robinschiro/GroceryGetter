[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path $PSScriptRoot -Parent
$envPath = Join-Path $workspaceRoot ".env"
$expectedRemote = "https://github.com/robinschiro/GroceryGetter.git"

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Missing $envPath. Add GITHUB_USERNAME and GITHUB_PAT before pushing."
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith("#")) {
    continue
  }

  $parts = $trimmed.Split("=", 2)
  if ($parts.Count -eq 2) {
    $settings[$parts[0].Trim()] = $parts[1].Trim()
  }
}

$username = $settings["GITHUB_USERNAME"]
$token = $settings["GITHUB_PAT"]
if (-not $username -or -not $token) {
  throw "GITHUB_USERNAME and GITHUB_PAT must both be set in .env."
}
if ($token -notmatch "^ghp_[A-Za-z0-9]+$") {
  throw "GITHUB_PAT does not look like a GitHub classic personal access token."
}

$gitCommand = Get-Command git -ErrorAction Stop
$gitExe = $gitCommand.Source
$gitRoot = Split-Path (Split-Path $gitExe -Parent) -Parent
$reportedExecPath = (& $gitExe --exec-path).Trim()
$helperDir = $reportedExecPath
$httpsHelper = Join-Path $helperDir "git-remote-https.exe"
if (-not (Test-Path -LiteralPath $httpsHelper)) {
  $helperDir = Join-Path $gitRoot "mingw64\bin"
  $httpsHelper = Join-Path $helperDir "git-remote-https.exe"
}
if (-not (Test-Path -LiteralPath $httpsHelper)) {
  throw "The Git HTTPS helper was not found in the reported or bundled helper directories."
}

$remoteUrl = (& $gitExe -C $workspaceRoot remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $remoteUrl -ne $expectedRemote) {
  throw "Refusing to send credentials: origin must be $expectedRemote."
}

$branch = (& $gitExe -C $workspaceRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or -not $branch) {
  throw "Unable to determine the current Git branch."
}

$previousExecPath = $env:GIT_EXEC_PATH
$previousTerminalPrompt = $env:GIT_TERMINAL_PROMPT
$previousConfigCount = $env:GIT_CONFIG_COUNT
$previousConfigKey0 = $env:GIT_CONFIG_KEY_0
$previousConfigValue0 = $env:GIT_CONFIG_VALUE_0
$previousConfigKey1 = $env:GIT_CONFIG_KEY_1
$previousConfigValue1 = $env:GIT_CONFIG_VALUE_1
$previousConfigKey2 = $env:GIT_CONFIG_KEY_2
$previousConfigValue2 = $env:GIT_CONFIG_VALUE_2
$previousConfigKey3 = $env:GIT_CONFIG_KEY_3
$previousConfigValue3 = $env:GIT_CONFIG_VALUE_3
$basicCredential = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${username}:${token}"))

try {
  $env:GIT_EXEC_PATH = $helperDir
  $env:GIT_TERMINAL_PROMPT = "0"
  $env:GIT_CONFIG_COUNT = "4"
  $env:GIT_CONFIG_KEY_0 = "http.sslBackend"
  $env:GIT_CONFIG_VALUE_0 = "openssl"
  $env:GIT_CONFIG_KEY_1 = "credential.helper"
  $env:GIT_CONFIG_VALUE_1 = "!exit 0"
  $env:GIT_CONFIG_KEY_2 = "http.https://github.com/robinschiro/GroceryGetter.git.extraHeader"
  $env:GIT_CONFIG_VALUE_2 = "Authorization: Basic $basicCredential"
  $env:GIT_CONFIG_KEY_3 = "safe.directory"
  $env:GIT_CONFIG_VALUE_3 = $workspaceRoot.Replace("\", "/")

  & $gitExe -C $workspaceRoot push origin $branch

  if ($LASTEXITCODE -ne 0) {
    throw "Git push failed with exit code $LASTEXITCODE."
  }
} finally {
  $env:GIT_EXEC_PATH = $previousExecPath
  $env:GIT_TERMINAL_PROMPT = $previousTerminalPrompt
  $env:GIT_CONFIG_COUNT = $previousConfigCount
  $env:GIT_CONFIG_KEY_0 = $previousConfigKey0
  $env:GIT_CONFIG_VALUE_0 = $previousConfigValue0
  $env:GIT_CONFIG_KEY_1 = $previousConfigKey1
  $env:GIT_CONFIG_VALUE_1 = $previousConfigValue1
  $env:GIT_CONFIG_KEY_2 = $previousConfigKey2
  $env:GIT_CONFIG_VALUE_2 = $previousConfigValue2
  $env:GIT_CONFIG_KEY_3 = $previousConfigKey3
  $env:GIT_CONFIG_VALUE_3 = $previousConfigValue3
  $basicCredential = $null
  $token = $null
  $settings.Clear()
}

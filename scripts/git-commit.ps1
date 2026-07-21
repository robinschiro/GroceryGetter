[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path $PSScriptRoot -Parent
$manifestPath = Join-Path $workspaceRoot ".codex-git-commit.json"

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Missing $manifestPath. Create it with a commitMessage string and a paths array."
}

try {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $commitMessage = [string]$manifest.commitMessage
  $paths = @($manifest.paths)
  $reviewOnly = $manifest.reviewOnly -eq $true

  if (-not $reviewOnly -and [string]::IsNullOrWhiteSpace($commitMessage)) {
    throw "commitMessage must be a non-empty string."
  }
  if (-not $reviewOnly -and ($commitMessage.Contains("`r") -or $commitMessage.Contains("`n"))) {
    throw "commitMessage must be a single line."
  }
  if ($paths.Count -eq 0) {
    throw "paths must contain at least one repository-relative path."
  }

  $validatedPaths = foreach ($pathValue in $paths) {
    $relativePath = [string]$pathValue
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
      throw "paths cannot contain empty values."
    }
    if ([IO.Path]::IsPathRooted($relativePath)) {
      throw "Refusing absolute path: $relativePath"
    }

    $normalizedPath = $relativePath.Replace("\", "/")
    if ($normalizedPath.StartsWith("./")) {
      $normalizedPath = $normalizedPath.Substring(2)
    }
    $segments = $normalizedPath.Split("/")
    if ($segments -contains "..") {
      throw "Refusing path traversal: $relativePath"
    }
    if (
      $normalizedPath -eq ".git" -or
      $normalizedPath.StartsWith(".git/") -or
      $normalizedPath -eq "data" -or
      $normalizedPath.StartsWith("data/") -or
      $normalizedPath -eq ".env" -or
      $normalizedPath.StartsWith(".env.")
    ) {
      throw "Refusing protected path: $relativePath"
    }

    $fullPath = [IO.Path]::GetFullPath((Join-Path $workspaceRoot $relativePath))
    $rootPrefix = $workspaceRoot.TrimEnd("\") + "\"
    if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Path is outside the repository: $relativePath"
    }

    $normalizedPath
  }

  $gitCommand = Get-Command git -ErrorAction Stop
  $gitExe = $gitCommand.Source

  if ($reviewOnly) {
    & $gitExe -C $workspaceRoot diff -- $validatedPaths
    if ($LASTEXITCODE -ne 0) {
      throw "Git diff failed with exit code $LASTEXITCODE."
    }
    return
  }

  & $gitExe -C $workspaceRoot add -- $validatedPaths
  if ($LASTEXITCODE -ne 0) {
    throw "Git add failed with exit code $LASTEXITCODE."
  }

  & $gitExe -C $workspaceRoot diff --cached --check
  if ($LASTEXITCODE -ne 0) {
    throw "The staged changes failed git diff --cached --check."
  }

  & $gitExe -C $workspaceRoot commit -m $commitMessage
  if ($LASTEXITCODE -ne 0) {
    throw "Git commit failed with exit code $LASTEXITCODE."
  }
} finally {
  Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
}

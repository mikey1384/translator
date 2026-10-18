<#
  Sync the Windows release machine to the newest release.
  - Pulls master (so release scripts are current)
  - Checks out the newest release tag (vX.Y.Z on origin)
  - Installs exactly the locked dependencies (npm ci)

  Usage: Double-click Sync-Windows-Release.bat, then Release-Windows-OneClick.bat.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Stage {
  param([string]$msg)
  Write-Host "`n=== $msg ===" -ForegroundColor Cyan
}

function Invoke-Checked {
  param([string]$Tool, [string[]]$Arguments)
  & $Tool @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "'$Tool $($Arguments -join ' ')' failed with exit code $LASTEXITCODE."
  }
}

$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
$exitCode = 0

try {
  . (Join-Path -Path $repo -ChildPath 'scripts\assert-windows-release-identity.ps1')

  Write-Stage 'Checking for local changes'
  $dirty = @(& git status --porcelain --untracked-files=no)
  if ($LASTEXITCODE -ne 0) { throw 'git status failed.' }
  if ($dirty.Count -ne 0) {
    throw ("This checkout has local changes, so it was left alone:`n" +
      ($dirty -join "`n") + "`nCommit, stash or discard them, then run this again.")
  }

  Write-Stage 'Fetching from GitHub'
  Invoke-Checked git @('fetch', '--force', '--tags', 'origin')
  Invoke-Checked git @('checkout', 'master')
  Invoke-Checked git @('pull', '--ff-only', 'origin', 'master')

  $tag = Get-NewestRemoteReleaseTag
  $tagCommit = Get-ReleaseGitValue -Arguments @('rev-parse', "${tag}^{}")
  $headCommit = Get-ReleaseGitValue -Arguments @('rev-parse', 'HEAD')
  if ($tagCommit -cne $headCommit) {
    # master moved on after the release; build exactly what was tagged.
    Write-Stage "Switching to $tag"
    Invoke-Checked git @('checkout', '--detach', $tag)
  }
  Write-Host "Checkout: $tag ($tagCommit)"

  Write-Stage 'Installing locked dependencies (npm ci)'
  Invoke-Checked npm @('ci')

  Write-Host "`nReady to release $tag. Now run Release-Windows-OneClick.bat." -ForegroundColor Green
} catch {
  Write-Host "`nSync failed: $($_.Exception.Message)" -ForegroundColor Red
  $exitCode = 1
}

exit $exitCode

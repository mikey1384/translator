Param(
  [Parameter(Mandatory = $true)] [string]$ReleaseRoot,
  [Parameter(Mandatory = $true)] [string]$RunId,
  [switch]$SkipPurge
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Keep this newer automation checkout separate from the clean tagged app.
# This command publishes. download/build/verify-signed never do.
. (Join-Path $PSScriptRoot 'assert-windows-release-identity.ps1')
. (Join-Path $PSScriptRoot 'windows-release-artifacts.ps1')

$mutex = $null
Push-Location -LiteralPath $ReleaseRoot
try {
  foreach ($tool in @('node', 'gh', 'rclone')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing release tool: $tool" }
  }
  $version = [string](Get-Content -LiteralPath 'package.json' | ConvertFrom-Json).version
  $mutex = Enter-WindowsReleaseMutex
  Assert-WindowsReleaseIdentity -Version $version
  & node (Join-Path $PSScriptRoot 'windows-token-release.mjs') verify-signed "v$version" $RunId (Get-Location).Path
  if ($LASTEXITCODE -ne 0) { throw 'Signed candidate verification failed. Nothing uploaded.' }

  # Refuse a stale release or conflicting immutable GitHub assets before
  # promoting the public R2 updater channel. The upload repeats these checks.
  & (Join-Path $PSScriptRoot 'bridge-windows-to-github.ps1') -Version $version -VerifyOnly
  & (Join-Path $PSScriptRoot 'upload-to-r2-win.ps1') -Version $version
  & (Join-Path $PSScriptRoot 'bridge-windows-to-github.ps1') -Version $version
  if (-not $SkipPurge) {
    & (Join-Path $PSScriptRoot 'purge-cloudflare-cache.ps1') -Version $version -IncludeVersioned
  } else {
    Write-Warning 'Cache purge was explicitly skipped; verify the public updater and installer before announcing the release.'
  }
  Write-Host "Published Windows v$version using the existing R2 retention and GitHub archive safeguards."
} finally {
  if ($null -ne $mutex) { Exit-WindowsReleaseMutex -Mutex $mutex }
  Pop-Location
}

<#
  One‑click Windows Release
  - Builds & signs the app (npm run package:win)
  - Uploads artifacts to Cloudflare R2 (scripts/upload-to-r2-win.ps1)
  - Injects release notes from dist/release-notes.txt or local annotated tag body
  - Purges Cloudflare cache (scripts/purge-cloudflare-cache.ps1)

  Usage: Double‑click Release-Windows-OneClick.bat in repo root
#>

Param(
  [Parameter(Mandatory = $false)]
  [switch]$SkipBuild,

  [Parameter(Mandatory = $false)]
  [switch]$SkipPurge,

  [Parameter(Mandatory = $false)]
  [switch]$IncludeVersionedPurge,

  [Parameter(Mandatory = $false)]
  [string]$ReleaseNotesFile,

  [Parameter(Mandatory = $false)]
  [switch]$AllowMissingReleaseNotes,

  [Parameter(Mandatory = $false)]
  [switch]$NoPause
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Stage {
  param([string]$msg)
  Write-Host "`n=== $msg ===" -ForegroundColor Cyan
}

function Get-RepoRoot {
  if ($PSScriptRoot) {
    return (Split-Path -Parent $PSScriptRoot)
  }
  if ($PSCommandPath) {
    $dir = Split-Path -Parent $PSCommandPath
    return (Split-Path -Parent $dir)
  }
  return (Get-Location).Path
}

function Ensure-Tool {
  param(
    [string]$tool,
    [string]$hint
  )
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Required tool '$tool' not found. $hint"
  }
}

function Get-AppVersion {
  $pkgPath = Join-Path -Path $repo -ChildPath 'package.json'
  if (-not (Test-Path -LiteralPath $pkgPath)) { throw "package.json not found at $pkgPath" }
  $pkg = Get-Content $pkgPath | ConvertFrom-Json
  if (-not $pkg.version) { throw 'No version found in package.json' }
  return [string]$pkg.version
}

function Confirm-ArtifactPaths {
  param([string]$version)
  $dist = Join-Path $repo 'dist'
  $installer = Get-WindowsInstallerPath -Version $version -DistPath $dist
  $latestYml = Join-Path $dist 'latest.yml'
  if (-not (Test-Path -LiteralPath $installer)) { throw "Missing installer: $installer" }
  if (-not (Test-Path -LiteralPath $latestYml)) { throw "Missing updater file: $latestYml (did the build finish?)" }

  Assert-WindowsInstallerSignature -InstallerPath $installer
  Assert-WindowsUpdaterMetadataMatchesInstaller `
    -LatestYamlPath $latestYml `
    -InstallerPath $installer `
    -Version $version
}

$repo = Get-RepoRoot
Set-Location -LiteralPath $repo
$exitCode = 0
$releaseMutex = $null

$releaseIdentityScript = Join-Path -Path $repo -ChildPath 'scripts\assert-windows-release-identity.ps1'
$releaseArtifactsScript = Join-Path -Path $repo -ChildPath 'scripts\windows-release-artifacts.ps1'

try {
  if (-not (Test-Path -LiteralPath $releaseIdentityScript)) {
    throw "Release identity preflight not found: $releaseIdentityScript"
  }
  . $releaseIdentityScript
  if (-not (Test-Path -LiteralPath $releaseArtifactsScript)) {
    throw "Windows release artifact helpers not found: $releaseArtifactsScript"
  }
  . $releaseArtifactsScript
  $releaseMutex = Enter-WindowsReleaseMutex

  Write-Stage 'Preflight checks'
  Ensure-Tool -tool 'npm' -hint 'Install Node.js / npm.'
  Ensure-Tool -tool 'rclone' -hint 'Install rclone and configure your R2 remote (e.g., r2-upload).'

  $version = Get-AppVersion
  Write-Host "Version: $version"
  Assert-WindowsReleaseIdentity -Version $version -RepoRoot $repo

  if (-not $SkipBuild) {
    Write-Stage 'Building & signing (npm run package:win)'
    & npm run package:win
    if ($LASTEXITCODE -ne 0) {
      throw "npm run package:win failed with exit code $LASTEXITCODE."
    }
  } else {
    Write-Host 'Skipping build as requested.'
  }
  
  Confirm-ArtifactPaths -version $version

  Write-Stage 'Validating packaged Windows payload'
  & cmd.exe /d /s /c 'scripts\test-windows-package.bat --no-launch'
  if ($LASTEXITCODE -ne 0) {
    throw "Windows package validation failed with exit code $LASTEXITCODE."
  }

  Write-Stage 'Uploading to Cloudflare R2'
  $uploadParams = @{
    Version = $version
  }
  if ($ReleaseNotesFile) {
    Write-Host "Using explicit release notes file override: $ReleaseNotesFile"
    $uploadParams.ReleaseNotesFile = $ReleaseNotesFile
  } else {
    Write-Host 'No -ReleaseNotesFile provided. Upload script will resolve release notes (dist/release-notes.txt, then local tag annotation).' -ForegroundColor Yellow
  }
  if ($AllowMissingReleaseNotes) {
    Write-Host 'WARNING: AllowMissingReleaseNotes enabled. This should only be used for emergency releases.' -ForegroundColor Yellow
    $uploadParams.AllowMissingReleaseNotes = $true
  }
  & "$repo\scripts\upload-to-r2-win.ps1" @uploadParams

  if (-not $SkipPurge) {
    Write-Stage 'Purging Cloudflare cache'
    & "$repo\scripts\purge-cloudflare-cache.ps1" -Version $version -IncludeVersioned:$IncludeVersionedPurge
  } else {
    Write-Host 'Skipping purge as requested.'
  }

  Write-Stage 'Done'
  Write-Host 'Release complete.' -ForegroundColor Green
  Write-Host 'You may now share the direct download:'
  Write-Host "  https://downloads.stage5.tools/win/latest/Translator-x64.exe"
  Write-Host 'And the app will auto-update from latest.yml at:'
  Write-Host "  https://downloads.stage5.tools/win/latest/latest.yml"

} catch {
  $exitCode = 1
  Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
} finally {
  if ($null -ne $releaseMutex) {
    Exit-WindowsReleaseMutex -Mutex $releaseMutex
  }
}

# Pause once for direct interactive launches. The .bat wrapper supplies
# -NoPause and owns its own pause so failures still propagate as an exit code.
if (-not $NoPause -and $Host.Name -notlike '*Visual Studio Code*') {
  Read-Host "Press Enter to exit"
}

exit $exitCode

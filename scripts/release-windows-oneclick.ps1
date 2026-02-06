<#
  One‑click Windows Release
  - Builds & signs the app (npm run package:win)
  - Uploads artifacts to Cloudflare R2 (scripts/upload-to-r2-win.ps1)
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
  [string]$ReleaseNotesFile
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
  $installer = Join-Path $dist "Translator Setup $version.exe"
  $latestYml = Join-Path $dist 'latest.yml'
  if (-not (Test-Path -LiteralPath $installer)) { throw "Missing installer: $installer" }
  if (-not (Test-Path -LiteralPath $latestYml)) { throw "Missing updater file: $latestYml (did the build finish?)" }
}

$repo = Get-RepoRoot
Set-Location -LiteralPath $repo

try {
  Write-Stage 'Preflight checks'
  Ensure-Tool -tool 'npm' -hint 'Install Node.js / npm.'
  Ensure-Tool -tool 'rclone' -hint 'Install rclone and configure your R2 remote (e.g., r2-upload).'

  $version = Get-AppVersion
  Write-Host "Version: $version"

  if (-not $SkipBuild) {
    Write-Stage 'Building & signing (npm run package:win)'
    npm run package:win
  } else {
    Write-Host 'Skipping build as requested.'
  }
  
  Confirm-ArtifactPaths -version $version

  if (-not $ReleaseNotesFile) {
    $defaultNotes = Join-Path -Path $repo -ChildPath 'dist/release-notes.txt'
    if (Test-Path -LiteralPath $defaultNotes) {
      $ReleaseNotesFile = $defaultNotes
      Write-Host "Using default release notes file: $ReleaseNotesFile"
    }
  }

  if ($ReleaseNotesFile) {
    Write-Stage 'Injecting release notes into latest.yml'
    & "$repo\scripts\set-latest-yml-release-notes.ps1" `
      -LatestYamlPath (Join-Path -Path $repo -ChildPath 'dist/latest.yml') `
      -Version $version `
      -ReleaseNotesFile $ReleaseNotesFile
  } else {
    Write-Host 'No release notes file provided. Windows latest.yml will not include releaseNotes, so post-update notice popup will not show.' -ForegroundColor Yellow
    Write-Host 'Tip: create dist/release-notes.txt or pass -ReleaseNotesFile <path>.' -ForegroundColor Yellow
  }

  Write-Stage 'Uploading to Cloudflare R2'
  if ($ReleaseNotesFile) {
    & "$repo\scripts\upload-to-r2-win.ps1" -Version $version -ReleaseNotesFile $ReleaseNotesFile
  } else {
    & "$repo\scripts\upload-to-r2-win.ps1" -Version $version
  }

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
  Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
  # Do not exit immediately; allow user to see the error
}

# Always pause when launched interactively (double-click)
if ($Host.Name -notlike '*Visual Studio Code*') {
  Read-Host "Press Enter to exit"
}

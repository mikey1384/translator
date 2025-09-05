<#
  Inform Legacy Windows Users (One-Click)
  - Detects appropriate GitHub release tag for Windows legacy updaters
  - Uploads dist/latest.yml, Windows installer, and blockmap (if present)
  - Creates the release if needed

  Double-click wrapper: Inform-Windows-Legacy-Users.bat (in repo root)
#>

Param(
  [Parameter(Mandatory = $false)]
  [string]$Repo = 'mikey1384/translator'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Stage { param([string]$m) Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Ensure-Tool { param([string]$t,[string]$hint) if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { throw "Required tool '$t' not found. $hint" } }
function Ensure-GhAuth {
  gh auth status | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI not authenticated. Run: gh auth login' }
}
function Exec-Gh {
  param([string[]]$A)
  Write-Host ("gh " + ($A -join ' ')) -ForegroundColor DarkGray
  & gh @A
  if ($LASTEXITCODE -ne 0) { throw ("GitHub CLI command failed: gh " + ($A -join ' ')) }
}

function Get-Version {
  $pkg = Get-Content package.json | ConvertFrom-Json
  if (-not $pkg.version) { throw 'No version field in package.json' }
  $v = [string]$pkg.version
  $v = $v.Trim()
  # Normalize in case someone put a leading 'v' or '.'
  $v = $v -replace '^[vV]\s*', ''
  $v = $v -replace '^\.', ''
  return $v
}

function Get-Files([string]$ver) {
  $dist = Join-Path (Get-Location) 'dist'
  $exe = Join-Path $dist "Translator Setup $ver.exe"
  $yml = Join-Path $dist 'latest.yml'
  if (-not (Test-Path -LiteralPath $exe)) { throw "Missing $exe (build first)" }
  if (-not (Test-Path -LiteralPath $yml)) { throw "Missing $yml (build first)" }
  $bm = $null
  $bmPath = Join-Path $dist "Translator Setup $ver.exe.blockmap"
  if (Test-Path -LiteralPath $bmPath) { $bm = $bmPath }
  return @{ exe = $exe; yml = $yml; blockmap = $bm }
}

function Pick-Tag([string]$ver, [string]$repo) {
  # Always target Windows-specific tag so legacy apps using '-win' pattern find it
  return "v$ver-win"
}

try {
  Write-Stage 'Preflight'
  Ensure-Tool -t 'gh' -hint 'Install GitHub CLI: https://cli.github.com and run gh auth login'
  Ensure-GhAuth

  $ver = Get-Version
  $files = Get-Files -ver $ver
  $tag = Pick-Tag -ver $ver -repo $Repo

  Write-Host "Repo: $Repo"
  Write-Host "Tag:  $tag"

  gh release view $tag --repo $Repo | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Stage "Creating GitHub release $tag"
    Exec-Gh -A @('release','create', $tag, '--repo', $Repo, '-t', "Translator $ver (Windows)", '-n', 'Windows bridge release for auto-update.', '--latest')
  }

  Write-Stage 'Uploading assets to GitHub release'
  Exec-Gh -A @('release','upload', $tag, '--repo', $Repo, $files.yml, $files.exe, '--clobber')
  # Also upload a hyphenated alias matching latest.yml (Translator-Setup-<ver>.exe)
  $temp = Join-Path $env:TEMP ("Translator-Setup-" + $ver + ".exe")
  Copy-Item -LiteralPath $files.exe -Destination $temp -Force
  try {
    Exec-Gh -A @('release','upload', $tag, '--repo', $Repo, $temp, '--clobber')
  } finally {
    Remove-Item -LiteralPath $temp -ErrorAction SilentlyContinue
  }
  if ($files.blockmap) {
    Exec-Gh -A @('release','upload', $tag, '--repo', $Repo, $files.blockmap, '--clobber')
  }

  Write-Host "Done. Legacy Windows installs will fetch:" -ForegroundColor Green
  Write-Host "  https://github.com/$Repo/releases/download/$tag/latest.yml"

} catch {
  Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
}

if ($Host.Name -notlike '*Visual Studio Code*') {
  Read-Host 'Press Enter to exit'
}

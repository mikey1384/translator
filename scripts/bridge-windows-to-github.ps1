Param(
  [Parameter(Mandatory = $false)]
  [string]$Version,

  [Parameter(Mandatory = $false)]
  [string]$Repo = 'mikey1384/translator',

  [Parameter(Mandatory = $false)]
  [string]$TagSuffix = '-win'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-Tool {
  param([string]$tool,[string]$hint)
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Required tool '$tool' not found. $hint"
  }
}

function Get-AppVersion {
  if ($Version -and $Version.Trim().Length -gt 0) { return $Version }
  $pkg = Get-Content package.json | ConvertFrom-Json
  if (-not $pkg.version) { throw 'No version in package.json; pass -Version' }
  return [string]$pkg.version
}

function Ensure-Files([string]$ver) {
  $dist = Join-Path (Get-Location) 'dist'
  $exe = Join-Path $dist "Translator Setup $ver.exe"
  $yml = Join-Path $dist 'latest.yml'
  if (-not (Test-Path -LiteralPath $exe)) { throw "Missing $exe (run the one-click build first)" }
  if (-not (Test-Path -LiteralPath $yml)) { throw "Missing $yml (run the one-click build first)" }
  $blockmapPath = Join-Path $dist "Translator Setup $ver.exe.blockmap"
  $bm = $null
  if (Test-Path -LiteralPath $blockmapPath) { $bm = $blockmapPath }
  return @{ exe = $exe; yml = $yml; blockmap = $bm }
}

Write-Host "== Windows Bridge to GitHub Release ==" -ForegroundColor Cyan
Ensure-Tool -tool 'gh' -hint 'Install GitHub CLI from https://cli.github.com and run gh auth login'

$ver = Get-AppVersion
$files = Ensure-Files -ver $ver
$tag = "v$ver$TagSuffix"
Write-Host "Repo: $Repo"
Write-Host "Tag:  $tag"

# Ensure auth and repo
gh auth status | Out-Null

# Create release if missing
$exists = $false
try { gh release view $tag --repo $Repo | Out-Null; $exists = $true } catch { $exists = $false }
if (-not $exists) {
  Write-Host "Creating GitHub Release $tag" -ForegroundColor Yellow
  gh release create $tag --repo $Repo -t "Translator $ver (Windows)" -n "Windows bridge release for auto-update." --latest | Out-Null
}

Write-Host "Uploading assets..." -ForegroundColor Cyan
gh release upload $tag --repo $Repo `
  "$($files.yml)" `
  "$($files.exe)" `
  --clobber | Out-Null

if ($files.blockmap) {
  gh release upload $tag --repo $Repo "$($files.blockmap)" --clobber | Out-Null
}

Write-Host "Done. Older Windows installs should now see the update." -ForegroundColor Green

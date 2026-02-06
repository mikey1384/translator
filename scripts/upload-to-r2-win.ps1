Param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [Parameter(Mandatory = $false)]
  [string]$SrcPath = "dist/Translator Setup $Version.exe",

  [Parameter(Mandatory = $false)]
  [string]$LatestYamlPath = 'dist/latest.yml',

  [Parameter(Mandatory = $false)]
  [string]$ReleaseNotesFile,

  [Parameter(Mandatory = $false)]
  [string]$BucketBase = 'r2-upload:ai-translator-downloads/win',

  [Parameter(Mandatory = $false)]
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-SourcePath {
  param([string]$p)
  if (Test-Path -LiteralPath $p) {
    return (Get-Item -LiteralPath $p).FullName
  }
  # Fallback: try to find the first matching installer in dist
  $candidates = Get-ChildItem -LiteralPath 'dist' -Filter 'Translator Setup *.exe' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
  if ($candidates -and $candidates.Count -gt 0) {
    return $candidates[0].FullName
  }
  throw "Source installer not found at '$p' and no matching 'Translator Setup *.exe' in dist/"
}

function Resolve-LatestYamlPath {
  param([string]$p)
  if (Test-Path -LiteralPath $p) {
    return (Get-Item -LiteralPath $p).FullName
  }
  throw "latest.yml not found at '$p'. Build with electron-builder first."
}

function Resolve-OptionalPath {
  param(
    [string]$pattern
  )
  $exact = Join-Path -Path 'dist' -ChildPath $pattern
  if (Test-Path -LiteralPath $exact) {
    return (Get-Item -LiteralPath $exact).FullName
  }
  $candidates = Get-ChildItem -LiteralPath 'dist' -Filter $pattern -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
  if ($candidates -and $candidates.Count -gt 0) {
    return $candidates[0].FullName
  }
  return $null
}

function Resolve-ReleaseNotesScriptPath {
  $scriptPath = Join-Path -Path $PSScriptRoot -ChildPath 'set-latest-yml-release-notes.ps1'
  if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Release notes injector script not found: $scriptPath"
  }
  return $scriptPath
}

function Resolve-DefaultReleaseNotesPath {
  param([string]$latestYamlFullPath)

  $latestYamlDir = Split-Path -Parent $latestYamlFullPath
  $candidatePaths = @(
    (Join-Path -Path $latestYamlDir -ChildPath 'release-notes.txt'),
    (Join-Path -Path (Get-Location) -ChildPath 'dist/release-notes.txt')
  )

  foreach ($candidate in $candidatePaths) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Get-Item -LiteralPath $candidate).FullName
    }
  }

  return $null
}

function Get-GitHubReleaseNotes {
  param([string]$version)

  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "WARNING: 'gh' CLI not found. Cannot fetch GitHub release notes for v$version." -ForegroundColor Yellow
    return $null
  }

  Write-Host "No release notes file provided. Fetching from GitHub release v$version..."
  $ghLines = @(& gh release view "v$version" --json body --jq '.body // empty' 2>$null)
  $ghExit = $LASTEXITCODE
  if ($ghExit -ne 0) {
    Write-Host "WARNING: Failed to fetch GitHub release notes for v$version (gh exit code $ghExit)." -ForegroundColor Yellow
    return $null
  }

  $ghNotes = ($ghLines -join "`n").Trim()
  if ($ghNotes.Length -eq 0) {
    Write-Host "WARNING: GitHub release v$version has no body text." -ForegroundColor Yellow
    return $null
  }

  Write-Host "Fetched release notes from GitHub."
  return $ghNotes
}

function Inject-ReleaseNotesIntoLatestYaml {
  param(
    [string]$injectorScript,
    [string]$latestYaml,
    [string]$version,
    [string]$releaseNotesFile,
    [string]$releaseNotesText
  )

  if ($releaseNotesFile) {
    & $injectorScript `
      -LatestYamlPath $latestYaml `
      -Version $version `
      -ReleaseNotesFile $releaseNotesFile
    return $true
  }

  if ($releaseNotesText -and $releaseNotesText.Trim().Length -gt 0) {
    & $injectorScript `
      -LatestYamlPath $latestYaml `
      -Version $version `
      -ReleaseNotes $releaseNotesText
    return $true
  }

  return $false
}

Write-Host "== Upload to R2 (Windows) =="
Write-Host "Version: $Version"
Write-Host "Force re-upload: $Force"

$src = Resolve-SourcePath -p $SrcPath
Write-Host "Source: $src"

$latestYaml = Resolve-LatestYamlPath -p $LatestYamlPath
Write-Host "latest.yml: $latestYaml"

$injectorScript = Resolve-ReleaseNotesScriptPath

if ($ReleaseNotesFile) {
  if (-not (Test-Path -LiteralPath $ReleaseNotesFile)) {
    throw "Release notes file not found: $ReleaseNotesFile"
  }
  $ReleaseNotesFile = (Get-Item -LiteralPath $ReleaseNotesFile).FullName
} else {
  $defaultNotes = Resolve-DefaultReleaseNotesPath -latestYamlFullPath $latestYaml
  if ($defaultNotes) {
    $ReleaseNotesFile = $defaultNotes
    Write-Host "Using default release notes file: $ReleaseNotesFile"
  }
}

$ghNotes = $null
if (-not $ReleaseNotesFile) {
  $ghNotes = Get-GitHubReleaseNotes -version $Version
}

$didInjectReleaseNotes = Inject-ReleaseNotesIntoLatestYaml `
  -injectorScript $injectorScript `
  -latestYaml $latestYaml `
  -version $Version `
  -releaseNotesFile $ReleaseNotesFile `
  -releaseNotesText $ghNotes

if (-not $didInjectReleaseNotes) {
  Write-Host "WARNING: latest.yml will not include releaseNotes. Windows post-update popup will be skipped for this release." -ForegroundColor Yellow
}

# Optional blockmap (present if differential metadata is generated)
$blockmap = Resolve-OptionalPath -pattern "Translator Setup *.exe.blockmap"
if ($null -ne $blockmap) {
  Write-Host "blockmap:   $blockmap"
} else {
  Write-Host "blockmap:   (none found)"
}

# Compute SHA256 and write checksum file
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $src).Hash
$hashFile = Join-Path $env:TEMP 'Translator-x64.exe.sha256'
"$hash  Translator-x64.exe" | Out-File -FilePath $hashFile -Encoding ascii -Force
Write-Host "Checksum: $hash"
Write-Host "Checksum file: $hashFile"

# Destinations
$destVersion = "$BucketBase/$Version/Translator-x64.exe"
$destLatest  = "$BucketBase/latest/Translator-x64.exe"
$destVersionSha = "$BucketBase/$Version/Translator-x64.exe.sha256"
$destLatestSha  = "$BucketBase/latest/Translator-x64.exe.sha256"

# Also compute names expected by latest.yml
$installerFileName = [System.IO.Path]::GetFileName($src)

# Hyphenated canonical name to match latest.yml (which may replace spaces with '-')
$installerHyphen = $installerFileName -replace ' ', '-'
$destHyphenLatest  = "$BucketBase/latest/$installerHyphen"
$destHyphenVersion = "$BucketBase/$Version/$installerHyphen"

# latest.yml destinations (primarily used by auto-updater)
$destLatestYaml  = "$BucketBase/latest/latest.yml"
$destVersionYaml = "$BucketBase/$Version/latest.yml"

# Blockmap destinations (match the installerFileName + .blockmap)
if ($null -ne $blockmap) {
  $blockmapFileName = "$installerFileName.blockmap"
  $destBlockmapLatest  = "$BucketBase/latest/$blockmapFileName"
  $destBlockmapVersion = "$BucketBase/$Version/$blockmapFileName"
}

function Invoke-RcloneCopyTo {
  param(
    [string]$from,
    [string]$to
  )
  Write-Host "rclone copyto -> $to"
  $rcloneArgs = @('copyto', '--progress', '--transfers', '4', '--retries', '3', '--retries-sleep', '2s')
  if ($Force) {
    # Force transfer even if size and times match
    $rcloneArgs += '--ignore-times'
  } else {
    # Fast path: skip if same size
    $rcloneArgs += '--size-only'
  }
  & rclone @rcloneArgs -- $from $to
}

function Invoke-RcloneCopyRemote {
  param(
    [string]$fromRemote,
    [string]$toRemote
  )
  Write-Host "rclone (remote->remote) copyto -> $toRemote"
  $rcloneArgs = @('copyto', '--retries', '3', '--retries-sleep', '2s')
  & rclone @rcloneArgs -- $fromRemote $toRemote
}

function Invoke-RcloneCopyAlways {
  param(
    [string]$from,
    [string]$to
  )
  Write-Host "rclone copyto (force) -> $to"
  $rcloneArgs = @('copyto', '--ignore-times', '--retries', '3', '--retries-sleep', '2s')
  & rclone @rcloneArgs -- $from $to
}

# Upload canonical installer to latest (hyphenated name matches latest.yml)
Invoke-RcloneCopyTo -from $src -to $destHyphenLatest

# Also upload directly to the versioned canonical path to guarantee folder presence
Invoke-RcloneCopyTo -from $src -to $destHyphenVersion

# Server-side copy canonical -> stable aliases (latest and versioned)
Invoke-RcloneCopyRemote -fromRemote $destHyphenLatest -toRemote $destLatest
Invoke-RcloneCopyRemote -fromRemote $destHyphenVersion -toRemote $destVersion

# Upload checksum files (always overwrite small metadata)
Invoke-RcloneCopyAlways -from $hashFile -to $destVersionSha
Invoke-RcloneCopyAlways -from $hashFile -to $destLatestSha

# Upload latest.yml to latest (always overwrite), and also write a copy to versioned
Invoke-RcloneCopyAlways -from $latestYaml -to $destLatestYaml
Invoke-RcloneCopyAlways -from $latestYaml -to $destVersionYaml

# Upload blockmap if present (place next to canonical and ensure versioned copy exists)
if ($null -ne $blockmap) {
  Invoke-RcloneCopyTo -from $blockmap -to $destBlockmapLatest
  Invoke-RcloneCopyTo -from $blockmap -to $destBlockmapVersion
}

Write-Host "Uploads complete."

# Print public-ish hints (bucket path only)
Write-Host "Canonical: $destHyphenLatest"
Write-Host "Versioned canonical: $destHyphenVersion"
Write-Host "Stable alias (latest): $destLatest"
Write-Host "latest.yml: $destLatestYaml"
if ($null -ne $blockmap) {
  Write-Host "blockmap: $destBlockmapLatest"
}

# Quick verify listing (best-effort)
try {
  Write-Host "--- Verify listing: latest/ ---"
  & rclone lsf "$BucketBase/latest" | Out-Host
} catch {}
try {
  Write-Host "--- Verify listing: $Version/ ---"
  & rclone lsf "$BucketBase/$Version" | Out-Host
} catch {}

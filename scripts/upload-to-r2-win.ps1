Param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [Parameter(Mandatory = $false)]
  [string]$SrcPath,

  [Parameter(Mandatory = $false)]
  [string]$LatestYamlPath = 'dist/latest.yml',

  [Parameter(Mandatory = $false)]
  [string]$ReleaseNotesFile,

  [Parameter(Mandatory = $false)]
  [string]$BucketBase = 'r2-upload:ai-translator-downloads/win',

  [Parameter(Mandatory = $false)]
  [switch]$Force,

  [Parameter(Mandatory = $false)]
  [switch]$AllowMissingReleaseNotes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-PackageVersion {
  $pkgPath = Join-Path -Path (Get-Location) -ChildPath 'package.json'
  if (-not (Test-Path -LiteralPath $pkgPath)) {
    return $null
  }
  try {
    $pkg = Get-Content -LiteralPath $pkgPath | ConvertFrom-Json
    if ($pkg -and $pkg.version) {
      return [string]$pkg.version
    }
  } catch {
    return $null
  }
  return $null
}

function Get-DefaultSourcePath {
  param([string]$version)
  return (Join-Path -Path 'dist' -ChildPath "Translator Setup $version.exe")
}

function Normalize-Version {
  param([string]$raw)

  if (-not $raw) { return $null }
  $v = $raw.Trim()
  if ($v.Length -eq 0) { return $null }

  # Common accidental placeholders/flags observed in manual invocations.
  if ($v -in @('version', '-version', '--version')) { return $null }

  # Accept optional "v" prefix from callers.
  if ($v.StartsWith('v') -or $v.StartsWith('V')) {
    $v = $v.Substring(1)
  }

  if ($v -match '^-') { return $null }

  # Strict SemVer-ish validation (supports prerelease + build metadata together).
  if ($v -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
    return $null
  }

  return $v
}

function Resolve-SourcePath {
  param(
    [string]$p,
    [string]$version,
    [switch]$AllowVersionFallback
  )

  if ($p -and (Test-Path -LiteralPath $p)) {
    return (Get-Item -LiteralPath $p).FullName
  }

  if (-not $AllowVersionFallback) {
    throw "Source installer not found at '$p'."
  }

  $normalizedVersion = Normalize-Version -raw $version
  if (-not $normalizedVersion) {
    throw "Cannot resolve fallback source installer because version '$version' is invalid."
  }

  $escapedVersion = [Regex]::Escape($normalizedVersion)
  # Fallback: only select an installer that exactly matches the normalized version.
  $candidates = Get-ChildItem -LiteralPath 'dist' -Filter 'Translator Setup *.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "^Translator Setup $escapedVersion\.exe$" } |
    Sort-Object LastWriteTime -Descending
  if ($candidates -and $candidates.Count -gt 0) {
    return $candidates[0].FullName
  }

  throw "Source installer not found at '$p' and no installer matching version '$normalizedVersion' in dist/"
}

function Assert-SourceMatchesVersion {
  param(
    [string]$fullPath,
    [string]$version
  )

  $fileNameNoExt = [System.IO.Path]::GetFileNameWithoutExtension($fullPath)
  if ($fileNameNoExt -notmatch '^Translator Setup (.+)$') {
    Write-Host "WARNING: Could not infer version from installer filename '$fileNameNoExt'. Skipping version consistency check." -ForegroundColor Yellow
    return
  }

  $fromName = Normalize-Version -raw $Matches[1]
  if (-not $fromName) {
    throw "Resolved installer '$fullPath' has an invalid version segment in its filename."
  }

  if ($fromName -ne $version) {
    throw "Resolved installer '$fullPath' does not match requested version '$version' (found '$fromName')."
  }
}

function Resolve-LatestYamlPath {
  param([string]$p)
  if (Test-Path -LiteralPath $p) {
    return (Get-Item -LiteralPath $p).FullName
  }
  throw "latest.yml not found at '$p'. Build with electron-builder first."
}

function Resolve-BlockmapPath {
  param([string]$installerPath)
  if (-not $installerPath) {
    return $null
  }

  $candidate = "$installerPath.blockmap"
  if (Test-Path -LiteralPath $candidate) {
    return (Get-Item -LiteralPath $candidate).FullName
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

function Get-TagReleaseNotes {
  param([string]$version)

  $normalizedVersion = Normalize-Version -raw $version
  if (-not $normalizedVersion) {
    Write-Host "WARNING: Invalid version '$version'. Skipping tag-based release notes lookup." -ForegroundColor Yellow
    return $null
  }

  $tag = "v$normalizedVersion"

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "WARNING: 'git' not found. Cannot read release notes from $tag." -ForegroundColor Yellow
    return $null
  }

  $tagTypeLines = @(& git cat-file -t $tag 2>$null)
  if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: Tag $tag not found locally." -ForegroundColor Yellow
    return $null
  }

  $tagType = ($tagTypeLines -join "`n").Trim()
  if ($tagType -ne 'tag') {
    Write-Host "WARNING: Tag $tag is lightweight. Annotated tags are required for release notes." -ForegroundColor Yellow
    return $null
  }

  $bodyLines = @(& git tag -l --format='%(contents:body)' $tag 2>$null)
  if ($LASTEXITCODE -eq 0) {
    $body = ($bodyLines -join "`n").Trim()
    if ($body.Length -gt 0) {
      Write-Host "Using release notes from local tag annotation body: $tag"
      return $body
    }
  }

  Write-Host "WARNING: Tag $tag annotation body is empty." -ForegroundColor Yellow
  return $null
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

$recoveredFromLegacyShift = $false
$legacyShiftedVersion = Normalize-Version -raw $SrcPath
if ($Version -and ($Version.Trim().ToLowerInvariant() -in @('-version', '--version')) -and $legacyShiftedVersion) {
  Write-Host "WARNING: Detected positional argument binding for '-Version'. Recovering by treating SrcPath '$SrcPath' as version." -ForegroundColor Yellow
  $Version = $legacyShiftedVersion
  $SrcPath = $null
  $recoveredFromLegacyShift = $true
}

$resolvedVersion = Normalize-Version -raw $Version
if (-not $resolvedVersion) {
  $pkgVersion = Read-PackageVersion
  $resolvedVersion = Normalize-Version -raw $pkgVersion
  if (-not $resolvedVersion) {
    throw "Invalid -Version '$Version' and unable to recover a valid version from package.json."
  }
  Write-Host "WARNING: Invalid -Version '$Version'. Falling back to package.json version '$resolvedVersion'." -ForegroundColor Yellow
}
$Version = $resolvedVersion

$srcPathProvided = (-not $recoveredFromLegacyShift) -and $PSBoundParameters.ContainsKey('SrcPath') -and -not [string]::IsNullOrWhiteSpace($SrcPath)
if (-not $srcPathProvided) {
  $SrcPath = Get-DefaultSourcePath -version $Version
}

$src = Resolve-SourcePath -p $SrcPath -version $Version -AllowVersionFallback:(-not $srcPathProvided)
Write-Host "Source: $src"
Assert-SourceMatchesVersion -fullPath $src -version $Version

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

$tagNotes = $null
if (-not $ReleaseNotesFile) {
  $tagNotes = Get-TagReleaseNotes -version $Version
}

$didInjectReleaseNotes = Inject-ReleaseNotesIntoLatestYaml `
  -injectorScript $injectorScript `
  -latestYaml $latestYaml `
  -version $Version `
  -releaseNotesFile $ReleaseNotesFile `
  -releaseNotesText $tagNotes

if (-not $didInjectReleaseNotes) {
  $msg = @(
    "Release notes are required for Windows releases."
    "Provide -ReleaseNotesFile, add dist/release-notes.txt, or create annotated tag v$Version with body text."
    "Pass -AllowMissingReleaseNotes only for emergency overrides."
  ) -join ' '
  if ($AllowMissingReleaseNotes) {
    Write-Host "WARNING: $msg latest.yml will not include releaseNotes for this release." -ForegroundColor Yellow
  } else {
    throw $msg
  }
}

# Optional blockmap (present if differential metadata is generated)
$blockmap = Resolve-BlockmapPath -installerPath $src
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

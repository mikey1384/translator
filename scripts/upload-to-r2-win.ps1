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

$releaseIdentityScript = Join-Path -Path $PSScriptRoot -ChildPath 'assert-windows-release-identity.ps1'
if (-not (Test-Path -LiteralPath $releaseIdentityScript)) {
  throw "Release identity preflight not found: $releaseIdentityScript"
}
. $releaseIdentityScript
$releaseArtifactsScript = Join-Path -Path $PSScriptRoot -ChildPath 'windows-release-artifacts.ps1'
if (-not (Test-Path -LiteralPath $releaseArtifactsScript)) {
  throw "Windows release artifact helpers not found: $releaseArtifactsScript"
}
. $releaseArtifactsScript
$releaseMutex = Enter-WindowsReleaseMutex
$hashFile = $null
$retentionTempDir = $null

try {

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
  return (Get-WindowsInstallerPath -Version $version -DistPath 'dist')
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

  $candidate = Get-WindowsInstallerPath -Version $normalizedVersion -DistPath 'dist'
  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    return (Get-Item -LiteralPath $candidate).FullName
  }

  throw "Source installer not found at '$p' or canonical path '$candidate'."
}

function Assert-SourceMatchesVersion {
  param(
    [string]$fullPath,
    [string]$version
  )

  $expectedName = Get-WindowsInstallerFileName -Version $version
  $actualName = [System.IO.Path]::GetFileName($fullPath)
  if ($actualName -cne $expectedName) {
    throw "Resolved installer '$fullPath' must use canonical filename '$expectedName'."
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
    Write-Host "Tag $tag not found locally. Attempting to fetch annotated tag from origin..." -ForegroundColor Yellow
    @(& git fetch --force origin "refs/tags/${tag}:refs/tags/${tag}" 2>$null) | Out-Null
    $tagTypeLines = @(& git cat-file -t $tag 2>$null)
    if ($LASTEXITCODE -ne 0) {
      Write-Host "WARNING: Tag $tag could not be resolved locally or from origin." -ForegroundColor Yellow
      return $null
    }
  }

  $tagType = ($tagTypeLines -join "`n").Trim()
  if ($tagType -ne 'tag') {
    Write-Host "WARNING: Tag $tag is lightweight. Annotated tags are required for release notes." -ForegroundColor Yellow
    return $null
  }

  # Windows PowerShell 5.1 decodes native-process stdout with the active
  # console code page. Capture Git through .NET with an explicit UTF-8 decoder
  # so typographic punctuation and localized notes reach latest.yml intact.
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = 'git'
  $startInfo.Arguments = "tag -l --format=`"%(contents:body)`" `"$tag`""
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $startInfo.StandardOutputEncoding = $utf8NoBom
  $startInfo.StandardErrorEncoding = $utf8NoBom

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  $null = $process.Start()
  $body = $process.StandardOutput.ReadToEnd().Trim()
  $gitError = $process.StandardError.ReadToEnd().Trim()
  $process.WaitForExit()

  if ($process.ExitCode -eq 0) {
    if ($body.Length -gt 0) {
      Write-Host "Using release notes from local tag annotation body: $tag"
      return $body
    }
  } elseif ($gitError.Length -gt 0) {
    Write-Host "WARNING: Unable to read UTF-8 tag body for ${tag}: $gitError" -ForegroundColor Yellow
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
if ($Force) {
  Write-Host 'WARNING: -Force is retained for caller compatibility. R2 latest/ pointers are always refreshed from the verified release candidate.' -ForegroundColor Yellow
}

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
Assert-WindowsReleaseIdentity -Version $Version

$srcPathProvided = (-not $recoveredFromLegacyShift) -and $PSBoundParameters.ContainsKey('SrcPath') -and -not [string]::IsNullOrWhiteSpace($SrcPath)
if (-not $srcPathProvided) {
  $SrcPath = Get-DefaultSourcePath -version $Version
}

$src = Resolve-SourcePath -p $SrcPath -version $Version -AllowVersionFallback:(-not $srcPathProvided)
Write-Host "Source: $src"
Assert-SourceMatchesVersion -fullPath $src -version $Version
Assert-WindowsInstallerSignature -InstallerPath $src

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

Assert-WindowsUpdaterMetadataMatchesInstaller `
  -LatestYamlPath $latestYaml `
  -InstallerPath $src `
  -Version $Version

# Optional blockmap (present if differential metadata is generated)
$blockmap = Resolve-BlockmapPath -installerPath $src
if ($null -ne $blockmap) {
  Write-Host "blockmap:   $blockmap"
} else {
  Write-Host "blockmap:   (none found)"
}

# Compute SHA256 and write checksum file
$hash = (Get-WindowsArtifactSha256Hex -FilePath $src).ToUpperInvariant()
$hashFile = Join-Path $env:TEMP ("Translator-x64-" + [Guid]::NewGuid().ToString('N') + '.exe.sha256')
"$hash  Translator-x64.exe" | Out-File -FilePath $hashFile -Encoding ascii -Force
Write-Host "Checksum: $hash"
Write-Host "Checksum file: $hashFile"

# R2 is a bounded delivery channel. GitHub Releases is the immutable archive.
$destLatest  = "$BucketBase/latest/Translator-x64.exe"
$destLatestSha  = "$BucketBase/latest/Translator-x64.exe.sha256"

# The physical artifact and latest.yml use the same canonical, URL-safe name.
$updaterInstallerName = [System.IO.Path]::GetFileName($src)
$destUpdaterLatest  = "$BucketBase/latest/$updaterInstallerName"

# latest.yml destinations (primarily used by auto-updater)
$destLatestYaml  = "$BucketBase/latest/latest.yml"
$destRetentionLatest = "$BucketBase/latest/release-retention.json"

# Blockmap destinations (match the installerFileName + .blockmap)
if ($null -ne $blockmap) {
  $blockmapFileName = "$updaterInstallerName.blockmap"
  $destBlockmapLatest  = "$BucketBase/latest/$blockmapFileName"
}

function Invoke-RcloneCopyTo {
  param(
    [string]$from,
    [string]$to
  )
  Write-Host "rclone copyto -> $to"
  # A same-size binary can still differ byte-for-byte on a rebuilt release.
  # Always transfer the selected artifact; exact remote verification follows.
  $rcloneArgs = @('copyto', '--progress', '--transfers', '4', '--retries', '3', '--retries-sleep', '2s', '--ignore-times')
  & rclone @rcloneArgs -- $from $to
  if ($LASTEXITCODE -ne 0) {
    throw "rclone copyto failed with exit code ${LASTEXITCODE}: $to"
  }
}

function Invoke-RcloneCopyRemote {
  param(
    [string]$fromRemote,
    [string]$toRemote
  )
  Write-Host "rclone (remote->remote) copyto -> $toRemote"
  $rcloneArgs = @('copyto', '--retries', '3', '--retries-sleep', '2s', '--ignore-times')
  & rclone @rcloneArgs -- $fromRemote $toRemote
  if ($LASTEXITCODE -ne 0) {
    throw "rclone remote copyto failed with exit code ${LASTEXITCODE}: $toRemote"
  }
}

function Invoke-RcloneCopyAlways {
  param(
    [string]$from,
    [string]$to
  )
  Write-Host "rclone copyto (force) -> $to"
  $rcloneArgs = @('copyto', '--ignore-times', '--retries', '3', '--retries-sleep', '2s')
  & rclone @rcloneArgs -- $from $to
  if ($LASTEXITCODE -ne 0) {
    throw "rclone forced copyto failed with exit code ${LASTEXITCODE}: $to"
  }
}

function Assert-RemoteMatchesLocal {
  param(
    [string]$localPath,
    [string]$remotePath
  )

  $verificationPath = Join-Path $env:TEMP ("translator-r2-verify-" + [Guid]::NewGuid().ToString('N'))
  try {
    & rclone copyto --retries 3 --retries-sleep 2s -- $remotePath $verificationPath
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to download remote object for verification: $remotePath"
    }

    $localItem = Get-Item -LiteralPath $localPath
    $remoteItem = Get-Item -LiteralPath $verificationPath
    if ($localItem.Length -ne $remoteItem.Length) {
      throw "Remote size mismatch for ${remotePath}: expected $($localItem.Length), got $($remoteItem.Length)."
    }

    $localHash = Get-WindowsArtifactSha256Hex -FilePath $localPath
    $remoteHash = Get-WindowsArtifactSha256Hex -FilePath $verificationPath
    if ($localHash -cne $remoteHash) {
      throw "Remote SHA256 mismatch for $remotePath."
    }
    Write-Host "Verified remote SHA256: $remotePath"
  } finally {
    if (Test-Path -LiteralPath $verificationPath) {
      Remove-Item -LiteralPath $verificationPath -Force
    }
  }
}

$policyScript = Join-Path -Path $PSScriptRoot -ChildPath 'release-storage-policy.mjs'
if (-not (Test-Path -LiteralPath $policyScript -PathType Leaf)) {
  throw "Release storage policy not found: $policyScript"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Required tool 'node' not found for bounded R2 latest cleanup."
}

# Snapshot the currently published manifest before any pointer changes. The
# generated record names the exact generation retained for interrupted clients.
# On a retry after the new manifest is public, the existing record is reused.
$retentionTempDir = Join-Path $env:TEMP ("translator-r2-retention-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $retentionTempDir | Out-Null
$publishedManifestPath = Join-Path $retentionTempDir 'published-latest.yml'
$existingRetentionPath = Join-Path $retentionTempDir 'existing-retention.json'
$retentionStatePath = Join-Path $retentionTempDir 'release-retention.json'
$latestInventory = @(& rclone lsf --files-only -- "$BucketBase/latest")
if ($LASTEXITCODE -ne 0) {
  throw "Unable to list R2 latest objects before preparing retention state."
}
if (@($latestInventory | Where-Object { $_ -ceq 'latest.yml' }).Count -ne 1) {
  throw "R2 latest inventory must contain exactly one latest.yml before promotion."
}
& rclone copyto --retries 3 --retries-sleep 2s -- $destLatestYaml $publishedManifestPath
if ($LASTEXITCODE -ne 0) {
  throw "Unable to snapshot the published R2 latest.yml before promotion."
}
$retentionArgs = @(
  $policyScript,
  'prepare-retention',
  '--platform', 'win',
  '--current-manifest', $latestYaml,
  '--published-manifest', $publishedManifestPath
)
if (@($latestInventory | Where-Object { $_ -ceq 'release-retention.json' }).Count -eq 1) {
  & rclone copyto --retries 3 --retries-sleep 2s -- $destRetentionLatest $existingRetentionPath
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to read the existing R2 release retention state."
  }
  $retentionArgs += @('--existing-retention', $existingRetentionPath)
}
$retentionArgs += @('--output', $retentionStatePath)
& node @retentionArgs
if ($LASTEXITCODE -ne 0) {
  throw "Unable to prepare exact R2 release retention state."
}

# Stage every latest/ payload before switching its updater manifest.
Invoke-RcloneCopyTo -from $src -to $destUpdaterLatest
Invoke-RcloneCopyRemote -fromRemote $destUpdaterLatest -toRemote $destLatest
Invoke-RcloneCopyAlways -from $hashFile -to $destLatestSha
if ($null -ne $blockmap) {
  Invoke-RcloneCopyTo -from $blockmap -to $destBlockmapLatest
}

Assert-RemoteMatchesLocal -localPath $src -remotePath $destUpdaterLatest
Assert-RemoteMatchesLocal -localPath $src -remotePath $destLatest
Assert-RemoteMatchesLocal -localPath $hashFile -remotePath $destLatestSha
if ($null -ne $blockmap) {
  Assert-RemoteMatchesLocal -localPath $blockmap -remotePath $destBlockmapLatest
}

# Persist the exact rollback payload set before switching latest.yml. If the
# pointer upload is interrupted, the next retry regenerates the same record.
Invoke-RcloneCopyAlways -from $retentionStatePath -to $destRetentionLatest
Assert-RemoteMatchesLocal -localPath $retentionStatePath -remotePath $destRetentionLatest

# latest.yml is the final updater pointer switch and is verified byte-for-byte.
Invoke-RcloneCopyAlways -from $latestYaml -to $destLatestYaml
Assert-RemoteMatchesLocal -localPath $latestYaml -remotePath $destLatestYaml

function Remove-StaleLatestObjects {
  $tempDir = Join-Path $env:TEMP ("translator-r2-prune-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempDir | Out-Null
  try {
    $inventoryPath = Join-Path $tempDir 'inventory.txt'
    $stalePath = Join-Path $tempDir 'stale.txt'
    $remainingPath = Join-Path $tempDir 'remaining.txt'

    $inventory = @(& rclone lsf --files-only -- "$BucketBase/latest")
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to list R2 latest objects before cleanup."
    }
    [System.IO.File]::WriteAllLines(
      $inventoryPath,
      [string[]]$inventory,
      (New-Object System.Text.UTF8Encoding($false))
    )

    & node $policyScript plan-latest `
      --platform win `
      --inventory $inventoryPath `
      --current-manifest $latestYaml `
      --retention $retentionStatePath `
      --output $stalePath
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to calculate the bounded R2 latest cleanup plan."
    }

    foreach ($staleObject in @(Get-Content -LiteralPath $stalePath)) {
      if ([string]::IsNullOrWhiteSpace($staleObject)) { continue }
      Write-Host "Removing stale latest object: $staleObject"
      & rclone deletefile -- "$BucketBase/latest/$staleObject"
      if ($LASTEXITCODE -ne 0) {
        throw "Unable to remove stale R2 latest object: $staleObject"
      }
    }

    $inventory = @(& rclone lsf --files-only -- "$BucketBase/latest")
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to verify R2 latest objects after cleanup."
    }
    [System.IO.File]::WriteAllLines(
      $inventoryPath,
      [string[]]$inventory,
      (New-Object System.Text.UTF8Encoding($false))
    )
    & node $policyScript plan-latest `
      --platform win `
      --inventory $inventoryPath `
      --current-manifest $latestYaml `
      --retention $retentionStatePath `
      --output $remainingPath
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to verify the bounded R2 latest cleanup plan."
    }
    if ((Get-Item -LiteralPath $remainingPath).Length -ne 0) {
      throw "R2 latest cleanup left stale Windows payloads."
    }
  } finally {
    if (Test-Path -LiteralPath $tempDir) {
      Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
  }
}

Remove-StaleLatestObjects

Write-Host "Uploads complete."

# Print public-ish hints (bucket path only)
Write-Host "Canonical: $destUpdaterLatest"
Write-Host "Stable alias (latest): $destLatest"
Write-Host "latest.yml: $destLatestYaml"
if ($null -ne $blockmap) {
  Write-Host "blockmap: $destBlockmapLatest"
}
} finally {
  if ($hashFile -and (Test-Path -LiteralPath $hashFile)) {
    Remove-Item -LiteralPath $hashFile -Force
  }
  if ($retentionTempDir -and (Test-Path -LiteralPath $retentionTempDir)) {
    Remove-Item -LiteralPath $retentionTempDir -Recurse -Force
  }
  Exit-WindowsReleaseMutex -Mutex $releaseMutex
}

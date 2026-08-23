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
$releaseMutex = Enter-WindowsReleaseMutex
$hashFile = $null

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

function Assert-InstallerSignature {
  param([string]$installerPath)

  $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Installer Authenticode signature is not valid: $($signature.Status) ($installerPath)"
  }
  if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)CN=Stage5 Tools LLC(?:,|$)') {
    throw "Installer signer is not Stage5 Tools LLC: $($signature.SignerCertificate.Subject)"
  }
}

function Get-Sha512Base64 {
  param([string]$filePath)

  $stream = [System.IO.File]::OpenRead($filePath)
  $sha512 = [System.Security.Cryptography.SHA512]::Create()
  try {
    return [Convert]::ToBase64String($sha512.ComputeHash($stream))
  } finally {
    $sha512.Dispose()
    $stream.Dispose()
  }
}

function Assert-UpdaterMetadataMatchesInstaller {
  param(
    [string]$latestYamlPath,
    [string]$installerPath,
    [string]$version
  )

  $yamlText = [System.IO.File]::ReadAllText($latestYamlPath)
  $escapedVersion = [Regex]::Escape($version)
  if ($yamlText -notmatch "(?m)^version:\s*$escapedVersion\s*$") {
    throw "latest.yml does not declare requested version '$version'."
  }

  $expectedName = ([System.IO.Path]::GetFileName($installerPath) -replace ' ', '-')
  $escapedName = [Regex]::Escape($expectedName)
  $urlMatch = [Regex]::Match(
    $yamlText,
    "(?m)^\s*-\s+url:\s*$escapedName\s*$"
  )
  if (-not $urlMatch.Success) {
    throw "latest.yml does not contain an updater entry for '$expectedName'."
  }
  if ($yamlText -notmatch "(?m)^path:\s*$escapedName\s*$") {
    throw "latest.yml path does not reference '$expectedName'."
  }

  $entryTail = $yamlText.Substring($urlMatch.Index + $urlMatch.Length)
  $nextEntry = [Regex]::Match($entryTail, "(?m)^\s*-\s+url:|^path:")
  if ($nextEntry.Success) {
    $entryTail = $entryTail.Substring(0, $nextEntry.Index)
  }

  $shaMatch = [Regex]::Match($entryTail, '(?m)^\s+sha512:\s*(\S+)\s*$')
  $sizeMatch = [Regex]::Match($entryTail, '(?m)^\s+size:\s*(\d+)\s*$')
  if (-not $shaMatch.Success -or -not $sizeMatch.Success) {
    throw "latest.yml entry for '$expectedName' is missing sha512 or size metadata."
  }

  $actualSize = (Get-Item -LiteralPath $installerPath).Length
  $declaredSize = [Int64]::Parse($sizeMatch.Groups[1].Value)
  if ($declaredSize -ne $actualSize) {
    throw "latest.yml size mismatch for '$expectedName': declared $declaredSize, actual $actualSize."
  }

  $actualSha512 = Get-Sha512Base64 -filePath $installerPath
  if ($shaMatch.Groups[1].Value -cne $actualSha512) {
    throw "latest.yml sha512 mismatch for '$expectedName'."
  }
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
    @(& git fetch --force origin "refs/tags/$tag:refs/tags/$tag" 2>$null) | Out-Null
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
  Write-Host 'WARNING: -Force is retained for caller compatibility. It can refresh latest/ pointers but cannot overwrite immutable versioned objects.' -ForegroundColor Yellow
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
Assert-InstallerSignature -installerPath $src

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

Assert-UpdaterMetadataMatchesInstaller `
  -latestYamlPath $latestYaml `
  -installerPath $src `
  -version $Version

# Optional blockmap (present if differential metadata is generated)
$blockmap = Resolve-BlockmapPath -installerPath $src
if ($null -ne $blockmap) {
  Write-Host "blockmap:   $blockmap"
} else {
  Write-Host "blockmap:   (none found)"
}

# Compute SHA256 and write checksum file
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $src).Hash
$hashFile = Join-Path $env:TEMP ("Translator-x64-" + [Guid]::NewGuid().ToString('N') + '.exe.sha256')
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
  $blockmapFileName = "$installerHyphen.blockmap"
  $destBlockmapLatest  = "$BucketBase/latest/$blockmapFileName"
  $destBlockmapVersion = "$BucketBase/$Version/$blockmapFileName"
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
    throw "rclone copyto failed with exit code $LASTEXITCODE: $to"
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
    throw "rclone remote copyto failed with exit code $LASTEXITCODE: $toRemote"
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
    throw "rclone forced copyto failed with exit code $LASTEXITCODE: $to"
  }
}

function Invoke-RcloneCopyImmutable {
  param(
    [string]$from,
    [string]$to
  )
  Write-Host "rclone copyto (immutable) -> $to"
  $rcloneArgs = @('copyto', '--immutable', '--progress', '--transfers', '4', '--retries', '3', '--retries-sleep', '2s')
  & rclone @rcloneArgs -- $from $to
  if ($LASTEXITCODE -ne 0) {
    throw "rclone immutable copyto failed with exit code ${LASTEXITCODE}: $to"
  }
}

function Invoke-RcloneCopyRemoteImmutable {
  param(
    [string]$fromRemote,
    [string]$toRemote
  )
  Write-Host "rclone (remote->remote immutable) copyto -> $toRemote"
  $rcloneArgs = @('copyto', '--immutable', '--retries', '3', '--retries-sleep', '2s')
  & rclone @rcloneArgs -- $fromRemote $toRemote
  if ($LASTEXITCODE -ne 0) {
    throw "rclone immutable remote copyto failed with exit code ${LASTEXITCODE}: $toRemote"
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

    $localHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $localPath).Hash
    $remoteHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $verificationPath).Hash
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

# Upload and verify immutable versioned objects first.
Invoke-RcloneCopyImmutable -from $src -to $destHyphenVersion
Invoke-RcloneCopyRemoteImmutable -fromRemote $destHyphenVersion -toRemote $destVersion
Invoke-RcloneCopyImmutable -from $hashFile -to $destVersionSha
if ($null -ne $blockmap) {
  Invoke-RcloneCopyImmutable -from $blockmap -to $destBlockmapVersion
}
Invoke-RcloneCopyImmutable -from $latestYaml -to $destVersionYaml

Assert-RemoteMatchesLocal -localPath $src -remotePath $destHyphenVersion
Assert-RemoteMatchesLocal -localPath $src -remotePath $destVersion
Assert-RemoteMatchesLocal -localPath $hashFile -remotePath $destVersionSha
if ($null -ne $blockmap) {
  Assert-RemoteMatchesLocal -localPath $blockmap -remotePath $destBlockmapVersion
}
Assert-RemoteMatchesLocal -localPath $latestYaml -remotePath $destVersionYaml

# Stage every latest/ payload before switching its updater manifest.
Invoke-RcloneCopyTo -from $src -to $destHyphenLatest
Invoke-RcloneCopyRemote -fromRemote $destHyphenLatest -toRemote $destLatest
Invoke-RcloneCopyAlways -from $hashFile -to $destLatestSha
if ($null -ne $blockmap) {
  Invoke-RcloneCopyTo -from $blockmap -to $destBlockmapLatest
}

Assert-RemoteMatchesLocal -localPath $src -remotePath $destHyphenLatest
Assert-RemoteMatchesLocal -localPath $src -remotePath $destLatest
Assert-RemoteMatchesLocal -localPath $hashFile -remotePath $destLatestSha
if ($null -ne $blockmap) {
  Assert-RemoteMatchesLocal -localPath $blockmap -remotePath $destBlockmapLatest
}

# latest.yml is the final pointer switch and is verified byte-for-byte.
Invoke-RcloneCopyAlways -from $latestYaml -to $destLatestYaml
Assert-RemoteMatchesLocal -localPath $latestYaml -remotePath $destLatestYaml

Write-Host "Uploads complete."

# Print public-ish hints (bucket path only)
Write-Host "Canonical: $destHyphenLatest"
Write-Host "Versioned canonical: $destHyphenVersion"
Write-Host "Stable alias (latest): $destLatest"
Write-Host "latest.yml: $destLatestYaml"
if ($null -ne $blockmap) {
  Write-Host "blockmap: $destBlockmapLatest"
}
} finally {
  if ($hashFile -and (Test-Path -LiteralPath $hashFile)) {
    Remove-Item -LiteralPath $hashFile -Force
  }
  Exit-WindowsReleaseMutex -Mutex $releaseMutex
}

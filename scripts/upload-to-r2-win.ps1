Param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [Parameter(Mandatory = $false)]
  [string]$SrcPath = "dist/Translator Setup $Version.exe",

  [Parameter(Mandatory = $false)]
  [string]$LatestYamlPath = 'dist/latest.yml',

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

Write-Host "== Upload to R2 (Windows) =="
Write-Host "Version: $Version"
Write-Host "Force re-upload: $Force"

$src = Resolve-SourcePath -p $SrcPath
Write-Host "Source: $src"

$latestYaml = Resolve-LatestYamlPath -p $LatestYamlPath
Write-Host "latest.yml: $latestYaml"

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

# Also upload versioned-named installer expected by latest.yml
$installerFileName = [System.IO.Path]::GetFileName($src)
$destVersionedVersion = "$BucketBase/$Version/$installerFileName"
$destVersionedLatest  = "$BucketBase/latest/$installerFileName"

# Additionally upload a hyphenated alias to match latest.yml (which may replace spaces with '-')
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

# Upload installer (versioned and latest)
Invoke-RcloneCopyTo -from $src -to $destVersion
Invoke-RcloneCopyTo -from $src -to $destLatest

# Upload installer again with the original file name (so latest.yml can reference it)
Invoke-RcloneCopyTo -from $src -to $destVersionedVersion
Invoke-RcloneCopyTo -from $src -to $destVersionedLatest

# Upload hyphenated alias to match latest.yml (Translator-Setup-<ver>.exe)
Invoke-RcloneCopyTo -from $src -to $destHyphenLatest
Invoke-RcloneCopyTo -from $src -to $destHyphenVersion

# Upload checksum files
Invoke-RcloneCopyTo -from $hashFile -to $destVersionSha
Invoke-RcloneCopyTo -from $hashFile -to $destLatestSha

# Upload latest.yml (both versioned and latest locations for traceability)
Invoke-RcloneCopyTo -from $latestYaml -to $destLatestYaml
Invoke-RcloneCopyTo -from $latestYaml -to $destVersionYaml

# Upload blockmap if present (must live alongside the original-named installer)
if ($null -ne $blockmap) {
  Invoke-RcloneCopyTo -from $blockmap -to $destBlockmapLatest
  Invoke-RcloneCopyTo -from $blockmap -to $destBlockmapVersion
}

Write-Host "Uploads complete."

# Print public-ish hints (bucket path only)
Write-Host "Versioned: $destVersion"
Write-Host "Latest:   $destLatest"
Write-Host "latest.yml: $destLatestYaml"
if ($null -ne $blockmap) {
  Write-Host "blockmap: $destBlockmapLatest"
}


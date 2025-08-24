Param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [Parameter(Mandatory = $false)]
  [string]$SrcPath = "dist/Translator Setup $Version.exe",

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

Write-Host "== Upload to R2 (Windows) =="
Write-Host "Version: $Version"
Write-Host "Force re-upload: $Force"

$src = Resolve-SourcePath -p $SrcPath
Write-Host "Source: $src"

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

# Upload checksum files
Invoke-RcloneCopyTo -from $hashFile -to $destVersionSha
Invoke-RcloneCopyTo -from $hashFile -to $destLatestSha

Write-Host "Uploads complete."

# Print public-ish hints (bucket path only)
Write-Host "Versioned: $destVersion"
Write-Host "Latest:   $destLatest"


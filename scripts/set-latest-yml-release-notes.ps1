Param(
  [Parameter(Mandatory = $true)]
  [string]$LatestYamlPath,

  [Parameter(Mandatory = $true)]
  [string]$Version,

  [Parameter(Mandatory = $false)]
  [string]$ReleaseNotes,

  [Parameter(Mandatory = $false)]
  [string]$ReleaseNotesFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
  if ($PSScriptRoot) {
    return (Split-Path -Parent $PSScriptRoot)
  }
  return (Get-Location).Path
}

$repo = Get-RepoRoot
$scriptPath = Join-Path -Path $repo -ChildPath 'scripts/inject-update-release-notes.mjs'
if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "Injector script not found: $scriptPath"
}

$args = @(
  $scriptPath,
  '--yaml', $LatestYamlPath,
  '--version', $Version
)

if ($ReleaseNotesFile -and $ReleaseNotesFile.Trim().Length -gt 0) {
  $args += @('--release-notes-file', $ReleaseNotesFile)
} elseif ($ReleaseNotes -and $ReleaseNotes.Trim().Length -gt 0) {
  $tempPath = Join-Path -Path $env:TEMP -ChildPath ("translator-release-notes-" + [Guid]::NewGuid().ToString() + '.txt')
  try {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tempPath, $ReleaseNotes, $utf8NoBom)
    $args += @('--release-notes-file', $tempPath)
    & node @args
  } finally {
    if ($tempPath -and (Test-Path -LiteralPath $tempPath)) {
      Remove-Item -LiteralPath $tempPath -Force
    }
  }
  exit $LASTEXITCODE
} else {
  throw 'Release notes are required. Pass -ReleaseNotes or -ReleaseNotesFile.'
}

& node @args
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

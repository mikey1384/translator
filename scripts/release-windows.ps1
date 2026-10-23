<#
  Windows release, start to finish (Release-Windows-OneClick.bat runs this).
  1. Pulls master, so these scripts are current.
  2. Checks out the newest release tag (vX.Y.Z on origin).
  3. Selects the verified build Node, then installs locked dependencies (npm ci).
  4. Runs that tag's scripts/release-windows-oneclick.ps1 (build, sign,
     upload to R2, attach to the GitHub release, purge the cache).
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Stage {
  param([string]$msg)
  Write-Host "`n=== $msg ===" -ForegroundColor Cyan
}

function Invoke-Checked {
  param([string]$Tool, [string[]]$Arguments)
  & $Tool @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "'$Tool $($Arguments -join ' ')' failed with exit code $LASTEXITCODE."
  }
}

# Tracked files a build regenerates; a leftover copy from an earlier build
# must not block switching versions.
$generatedFiles = @('render-host-script.js')

$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
$exitCode = 0
$releaseNode = $null

try {
  . (Join-Path -Path $repo -ChildPath 'scripts\assert-windows-release-identity.ps1')

  Write-Stage 'Checking for local changes'
  $dirty = @(& git status --porcelain --untracked-files=no)
  if ($LASTEXITCODE -ne 0) { throw 'git status failed.' }
  $dirtyPaths = @($dirty | ForEach-Object { ([string]$_).Substring(3).Trim() })
  $unexpected = @($dirtyPaths | Where-Object { $generatedFiles -notcontains $_ })
  if ($unexpected.Count -ne 0) {
    throw ("This checkout has local changes, so it was left alone:`n" +
      ($dirty -join "`n") + "`nCommit, stash or discard them, then run this again.")
  }
  if ($dirtyPaths.Count -ne 0) {
    Write-Host "Restoring build output: $($dirtyPaths -join ', ')"
    Invoke-Checked git (@('checkout', '--') + $dirtyPaths)
  }

  Write-Stage 'Fetching from GitHub'
  Invoke-Checked git @('fetch', '--force', '--tags', 'origin')
  Invoke-Checked git @('checkout', 'master')
  Invoke-Checked git @('pull', '--ff-only', 'origin', 'master')

  $tag = Get-NewestRemoteReleaseTag
  $tagCommit = Get-ReleaseGitValue -Arguments @('rev-parse', "${tag}^{}")
  $headCommit = Get-ReleaseGitValue -Arguments @('rev-parse', 'HEAD')
  if ($tagCommit -cne $headCommit) {
    # master moved on after the release; build exactly what was tagged.
    Write-Stage "Switching to $tag"
    Invoke-Checked git @('checkout', '--detach', $tag)
  }
  Write-Host "Releasing: $tag ($tagCommit)"

  # Load the helper after checkout so its pin belongs to the release tag.
  . (Join-Path $repo 'scripts\windows-release-node.ps1')
  $releaseNode = Use-WindowsReleaseNode -RepoRoot $repo

  Write-Stage 'Installing locked dependencies (npm ci)'
  Invoke-Checked npm @('ci')

  # A fresh process loads the release script as it is at the tag.
  Write-Stage "Releasing $tag for Windows"
  $releaseScript = Join-Path -Path $repo -ChildPath 'scripts\release-windows-oneclick.ps1'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $releaseScript -NoPause
  $exitCode = $LASTEXITCODE
} catch {
  Write-Host "`nRelease stopped: $($_.Exception.Message)" -ForegroundColor Red
  $exitCode = 1
} finally {
  if ($null -ne $releaseNode) {
    Restore-WindowsReleaseNode -Context $releaseNode
  }
  # Leave the folder on master, so the next double-click runs the newest
  # version of this launcher rather than the one inside an old tag.
  & git checkout --quiet -- @generatedFiles 2>$null
  & git checkout --quiet master 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Note: could not switch back to master; run "git checkout master" before the next release.' -ForegroundColor Yellow
  }
}

exit $exitCode

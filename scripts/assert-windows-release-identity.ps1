function Invoke-ReleaseGit {
  param([string[]]$Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell converts a native program's stderr into error records.
    # Git can emit harmless line-ending warnings while returning success, so
    # capture the native exit code without allowing those warnings to bypass it.
    $ErrorActionPreference = 'Continue'
    $lines = @(& git @Arguments 2>$null)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $exitCode."
  }
  return $lines
}

function Get-ReleaseGitValue {
  param([string[]]$Arguments)

  $lines = @(Invoke-ReleaseGit -Arguments $Arguments)
  return ($lines -join "`n").Trim()
}

function Get-ReleaseGitLines {
  param([string[]]$Arguments)

  $lines = @(Invoke-ReleaseGit -Arguments $Arguments)
  return @($lines | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
}

function Assert-WindowsReleaseWorktree {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedCommit,

    [Parameter(Mandatory = $false)]
    [string]$RepoRoot = (Get-Location).Path
  )

  Push-Location -LiteralPath $RepoRoot
  try {
    $expected = Get-ReleaseGitValue -Arguments @('rev-parse', "$ExpectedCommit^{commit}")
    $staged = @(Get-ReleaseGitLines -Arguments @(
      'diff', '--cached', '--no-ext-diff', '--no-textconv',
      '--ignore-submodules=none', '--name-status', '--no-renames',
      $expected, '--'
    ))
    $unstaged = @(Get-ReleaseGitLines -Arguments @(
      'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none',
      '--name-status', '--no-renames', '--'
    ))
    $untracked = @(Get-ReleaseGitLines -Arguments @(
      'ls-files', '--others', '--exclude-standard'
    ))

    $changes = @(
      foreach ($line in $staged) { "staged: $line" }
      foreach ($line in $unstaged) { "unstaged: $line" }
      foreach ($line in $untracked) { "untracked: $line" }
    )
    if ($changes.Count -ne 0) {
      $details = ($changes | ForEach-Object { "  $_" }) -join "`n"
      throw "Tracked, staged, or untracked working-tree content would make the Windows build differ from its release commit. Use a clean release checkout.`n$details"
    }
  } finally {
    Pop-Location
  }
}

function Assert-WindowsReleaseIdentity {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $false)]
    [string]$RepoRoot = (Get-Location).Path
  )

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Required tool 'git' not found."
  }

  Push-Location -LiteralPath $RepoRoot
  try {
    $packagePath = Join-Path -Path $RepoRoot -ChildPath 'package.json'
    if (-not (Test-Path -LiteralPath $packagePath)) {
      throw "package.json not found at $packagePath."
    }
    $packageVersion = [string](
      (Get-Content -LiteralPath $packagePath | ConvertFrom-Json).version
    )
    if ($packageVersion -cne $Version) {
      throw "Requested version '$Version' does not match package.json version '$packageVersion'."
    }

    $tag = "v$Version"
    $tagType = $null
    try {
      $tagType = Get-ReleaseGitValue -Arguments @('cat-file', '-t', $tag)
    } catch {
      Write-Host "Tag $tag not found locally. Fetching the exact tag from origin..." -ForegroundColor Yellow
      & git fetch --force origin "refs/tags/${tag}:refs/tags/${tag}"
      if ($LASTEXITCODE -ne 0) {
        throw "Unable to fetch release tag $tag from origin."
      }
      $tagType = Get-ReleaseGitValue -Arguments @('cat-file', '-t', $tag)
    }
    if ($tagType -cne 'tag') {
      throw "Release tag $tag must be an annotated tag."
    }

    $tagCommit = Get-ReleaseGitValue -Arguments @('rev-parse', "${tag}^{}")
    $headCommit = Get-ReleaseGitValue -Arguments @('rev-parse', 'HEAD')
    if ($tagCommit -cne $headCommit) {
      throw "Release tag $tag points to $tagCommit, but the Windows build is at $headCommit."
    }

    Assert-WindowsReleaseWorktree -ExpectedCommit $tagCommit -RepoRoot $RepoRoot
  } finally {
    Pop-Location
  }
}

function Get-NewestRemoteReleaseTag {
  # Highest vMAJOR.MINOR.PATCH tag on origin (prerelease tags ignored).
  $lines = @(Get-ReleaseGitLines -Arguments @('ls-remote', '--tags', '--refs', 'origin', 'refs/tags/v*'))
  $best = $null
  foreach ($line in $lines) {
    if ($line -match 'refs/tags/v(\d+)\.(\d+)\.(\d+)$') {
      $candidate = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
      if ($null -eq $best -or $candidate -gt $best) { $best = $candidate }
    }
  }
  if ($null -eq $best) { throw 'No release tags found on origin.' }
  return "v$best"
}

function Assert-WindowsReleaseIsNewest {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $false)]
    [string]$Repository = 'mikey1384/translator'
  )

  # Releasing an older checkout re-uploads an old installer to R2 before the
  # GitHub step can refuse it, so stop before anything is built or uploaded.
  $newest = Get-NewestRemoteReleaseTag
  if ($newest -cne "v$Version") {
    throw ("This checkout is v$Version, but the newest release is $newest. " +
      'Run Sync-Windows-Release.bat first, then run this again.')
  }

  # The Mac Action publishes the GitHub release the Windows assets attach to.
  $latestTag = (& gh api "repos/$Repository/releases/latest" --jq '.tag_name' 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'Could not read the latest GitHub release (gh api failed).' }
  $latestTag = ([string]$latestTag).Trim()
  if ($latestTag -cne "v$Version") {
    throw ("GitHub's latest published release is '$latestTag', not v$Version. " +
      'Wait for the macOS release Action to publish v' + $Version + ', then run this again.')
  }
}

function Assert-WindowsDependenciesInstalled {
  param(
    [Parameter(Mandatory = $false)]
    [string]$RepoRoot = (Get-Location).Path
  )

  # node_modules must match the lockfile, or the installer ships stale
  # packages (an old Electron, for one).
  $lockPath = Join-Path -Path $RepoRoot -ChildPath 'package-lock.json'
  $installedPath = Join-Path -Path $RepoRoot -ChildPath 'node_modules\electron\package.json'
  if (-not (Test-Path -LiteralPath $installedPath)) {
    throw 'Dependencies are not installed. Run Sync-Windows-Release.bat (or npm ci) first.'
  }
  $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
  $expected = [string]$lock.packages.'node_modules/electron'.version
  $installed = [string]((Get-Content -LiteralPath $installedPath -Raw | ConvertFrom-Json).version)
  if ($expected -cne $installed) {
    throw ("Installed Electron is $installed, but package-lock.json needs $expected. " +
      'Run Sync-Windows-Release.bat (or npm ci) first.')
  }
}

function Enter-WindowsReleaseMutex {
  $mutex = [System.Threading.Mutex]::new(
    $false,
    'Local\Stage5.Translator.WindowsRelease'
  )
  $acquired = $false
  try {
    $acquired = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    # The previous publisher died while owning the exact OS mutex. Windows
    # transfers ownership to this thread, so recovery can proceed safely.
    $acquired = $true
  }
  if (-not $acquired) {
    $mutex.Dispose()
    throw 'Another Windows release transaction is already running on this host.'
  }
  return $mutex
}

function Exit-WindowsReleaseMutex {
  param([System.Threading.Mutex]$Mutex)

  if ($null -eq $Mutex) { return }
  try {
    $Mutex.ReleaseMutex()
  } finally {
    $Mutex.Dispose()
  }
}

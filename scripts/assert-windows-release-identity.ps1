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

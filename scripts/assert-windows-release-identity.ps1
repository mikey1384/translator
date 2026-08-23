function Get-ReleaseGitValue {
  param([string[]]$Arguments)

  $lines = @(& git @Arguments 2>$null)
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
  return ($lines -join "`n").Trim()
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

    $statusLines = @(& git status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to inspect the release worktree (git status exit $LASTEXITCODE)."
    }
    if ($statusLines.Count -ne 0) {
      throw 'Tracked, staged, or untracked working-tree content would make the Windows build differ from its release tag. Use a clean release checkout.'
    }
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

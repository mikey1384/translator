# A private, verified build runtime. Never changes the machine's Node install
# or persistent PATH. The ZIP checksum comes from Node's official SHASUMS256.txt.
function Use-WindowsReleaseNode {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $pinPath = Join-Path $RepoRoot 'scripts\windows-release-node.json'
  $pin = Get-Content -LiteralPath $pinPath -Raw | ConvertFrom-Json
  $version = [string]$pin.version
  $expectedHash = [string]$pin.sha256
  if ($version -notmatch '^\d+\.\d+\.\d+$' -or $expectedHash -notmatch '^[a-f0-9]{64}$') {
    throw 'Invalid Windows release Node pin.'
  }
  if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'Windows releases require a 64-bit Windows machine.'
  }

  $cacheRoot = Join-Path $RepoRoot '.local\windows-release-node'
  [IO.Directory]::CreateDirectory($cacheRoot) | Out-Null
  $archiveName = "node-v$version-win-x64.zip"
  $archivePath = Join-Path $cacheRoot $archiveName
  $runRoot = Join-Path $cacheRoot ([Guid]::NewGuid().ToString('N'))
  $downloadPath = "$runRoot.zip"
  $previousPath = $env:Path

  try {
    Write-Host "Preparing verified release Node $version (Windows x64)..."
    $cacheValid = (Test-Path -LiteralPath $archivePath -PathType Leaf) -and
      ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ieq $expectedHash)
    if (-not $cacheValid) {
      $previousProtocol = [Net.ServicePointManager]::SecurityProtocol
      $previousProgress = $ProgressPreference
      try {
        [Net.ServicePointManager]::SecurityProtocol = $previousProtocol -bor [Net.SecurityProtocolType]::Tls12
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 `
          -Uri "https://nodejs.org/dist/v$version/$archiveName" -OutFile $downloadPath
      } finally {
        [Net.ServicePointManager]::SecurityProtocol = $previousProtocol
        $ProgressPreference = $previousProgress
      }
      if ((Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash -ine $expectedHash) {
        throw 'Downloaded release Node archive failed its SHA256 checksum. Nothing was executed.'
      }
      Move-Item -LiteralPath $downloadPath -Destination $archivePath -Force
    }

    # Extract afresh from the checked archive; never trust a previously expanded
    # npm tree. Each invocation owns its directory, including nested launchers.
    Expand-Archive -LiteralPath $archivePath -DestinationPath $runRoot
    $nodeRoot = Join-Path $runRoot "node-v$version-win-x64"
    $nodePath = Join-Path $nodeRoot 'node.exe'
    $npmPath = Join-Path $nodeRoot 'npm.cmd'
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $npmPath -PathType Leaf)) {
      throw 'Verified Node archive is missing node.exe or npm.cmd.'
    }
    $identity = & $nodePath -p "process.versions.node + '/' + process.platform + '/' + process.arch"
    if ($LASTEXITCODE -ne 0 -or $identity -cne "$version/win32/x64") {
      throw 'Release Node does not match the pinned version and Windows x64 architecture.'
    }
    $securityCheck = Join-Path $RepoRoot 'scripts\check-security-runtime.mjs'
    & $nodePath $securityCheck --node-only | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw 'Pinned release Node failed its security check. The build was not started.'
    }

    # npm, npx and all child PowerShell/cmd processes inherit this exact runtime.
    $env:Path = "$nodeRoot;$previousPath"
    return [PSCustomObject]@{ Root = $runRoot; PreviousPath = $previousPath }
  } catch {
    $env:Path = $previousPath
    if (Test-Path -LiteralPath $runRoot) {
      Remove-Item -LiteralPath $runRoot -Recurse -Force
    }
    throw
  } finally {
    if (Test-Path -LiteralPath $downloadPath) {
      Remove-Item -LiteralPath $downloadPath -Force
    }
  }
}

function Restore-WindowsReleaseNode {
  param([Parameter(Mandatory = $true)]$Context)
  $env:Path = $Context.PreviousPath
  try {
    Remove-Item -LiteralPath $Context.Root -Recurse -Force
  } catch {
    # Cleanup must not hide a build failure or prevent the mutex from releasing.
    Write-Warning 'Could not remove the temporary release Node directory under .local.'
  }
}

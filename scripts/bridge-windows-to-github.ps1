Param(
  [Parameter(Mandatory = $false)]
  [string]$Version,

  [Parameter(Mandatory = $false)]
  [string]$Repo = 'mikey1384/translator'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-Tool {
  param([string]$Tool, [string]$Hint)

  if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) {
    throw "Required tool '$Tool' not found. $Hint"
  }
}

function Invoke-GhCapture {
  param([string[]]$Arguments)

  $output = @(& gh @Arguments)
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI command failed with exit code ${LASTEXITCODE}: gh $($Arguments -join ' ')"
  }
  return ($output -join [Environment]::NewLine)
}

function Invoke-GhJson {
  param([string[]]$Arguments)

  $json = Invoke-GhCapture -Arguments $Arguments
  if ([string]::IsNullOrWhiteSpace($json)) {
    throw "GitHub CLI returned no JSON: gh $($Arguments -join ' ')"
  }
  try {
    return ($json | ConvertFrom-Json)
  } catch {
    throw "GitHub CLI returned invalid JSON: gh $($Arguments -join ' ')"
  }
}

function Exec-Gh {
  param([string[]]$Arguments)

  & gh @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI command failed with exit code ${LASTEXITCODE}: gh $($Arguments -join ' ')"
  }
}

function Get-AppVersion {
  if (-not [string]::IsNullOrWhiteSpace($Version)) {
    return $Version.Trim()
  }

  $pkg = Get-Content -LiteralPath 'package.json' | ConvertFrom-Json
  if (-not $pkg.version) {
    throw 'No version in package.json; pass -Version.'
  }
  return ([string]$pkg.version).Trim()
}

$releaseArtifactsScript = Join-Path -Path $PSScriptRoot -ChildPath 'windows-release-artifacts.ps1'
$releaseIdentityScript = Join-Path -Path $PSScriptRoot -ChildPath 'assert-windows-release-identity.ps1'
if (-not (Test-Path -LiteralPath $releaseArtifactsScript -PathType Leaf)) {
  throw "Windows release artifact helpers not found: $releaseArtifactsScript"
}
. $releaseArtifactsScript
if (-not (Test-Path -LiteralPath $releaseIdentityScript -PathType Leaf)) {
  throw "Windows release identity helpers not found: $releaseIdentityScript"
}
. $releaseIdentityScript

function Get-ReleaseFiles {
  param([string]$ReleaseVersion)

  $dist = Join-Path -Path (Get-Location) -ChildPath 'dist'
  $installer = Get-WindowsInstallerPath -Version $ReleaseVersion -DistPath $dist
  $latestYaml = Join-Path -Path $dist -ChildPath 'latest.yml'
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Missing $installer (run the one-click build first)."
  }
  if (-not (Test-Path -LiteralPath $latestYaml -PathType Leaf)) {
    throw "Missing $latestYaml (run the one-click build first)."
  }

  $blockmapPath = "$installer.blockmap"
  $blockmap = $null
  if (Test-Path -LiteralPath $blockmapPath -PathType Leaf) {
    $blockmap = $blockmapPath
  }

  return @{
    installer = $installer
    latestYaml = $latestYaml
    blockmap = $blockmap
  }
}

function New-LocalAssetDescriptor {
  param([string]$Path)

  $item = Get-Item -LiteralPath $Path
  $sha256 = Get-WindowsArtifactSha256Hex -FilePath $Path
  return [PSCustomObject]@{
    Path = $item.FullName
    Name = $item.Name
    Size = [Int64]$item.Length
    Digest = "sha256:$sha256"
  }
}

function Get-LocalWindowsAssets {
  param([hashtable]$Files)

  # Payloads must become available before latest.yml exposes them.
  $paths = @($Files.installer)
  if ($Files.blockmap) {
    $paths += $Files.blockmap
  }
  $paths += $Files.latestYaml

  $assets = @()
  foreach ($path in $paths) {
    $assets += New-LocalAssetDescriptor -Path $path
  }
  return $assets
}

function Get-RequiredMacAssetNames {
  param([string]$ReleaseVersion)

  $names = @()
  foreach ($arch in @('arm64', 'x64')) {
    foreach ($suffix in @('dmg', 'dmg.blockmap', 'zip', 'zip.blockmap')) {
      $names += "Translator-$ReleaseVersion-darwin-$arch.$suffix"
    }
  }
  $names += 'latest-mac.yml'
  return $names
}

function Get-MatchingReleases {
  param(
    [string]$Repository,
    [string]$ReleaseTag
  )

  # GitHub's by-tag endpoint omits drafts. Filter every releases page and emit
  # one base64-encoded JSON object per match so this also works with older gh
  # versions that support --paginate but not --slurp.
  $listArguments = @(
    'api',
    '--paginate',
    "repos/$Repository/releases?per_page=100",
    '--jq',
    ".[] | select(.tag_name == `"$ReleaseTag`") | {id, tag_name} | @base64"
  )
  $encodedMatches = @(& gh @listArguments)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to enumerate GitHub releases (gh exit $LASTEXITCODE)."
  }

  $matches = @()
  foreach ($encodedMatch in $encodedMatches) {
    if ([string]::IsNullOrWhiteSpace($encodedMatch)) {
      continue
    }
    try {
      $jsonBytes = [Convert]::FromBase64String($encodedMatch.Trim())
      $candidate = [Text.Encoding]::UTF8.GetString($jsonBytes) | ConvertFrom-Json
    } catch {
      throw 'GitHub CLI returned an invalid encoded release record.'
    }
    if ([string]$candidate.tag_name -cne $ReleaseTag) {
      throw "GitHub release enumeration returned unexpected tag '$($candidate.tag_name)'."
    }
    $matches += $candidate
  }
  return $matches
}

function Get-ReleaseById {
  param(
    [string]$Repository,
    [Int64]$ReleaseId
  )

  return Invoke-GhJson -Arguments @('api', "repos/$Repository/releases/$ReleaseId")
}

function Assert-CanonicalReleaseIdentity {
  param(
    [object]$Release,
    [string]$ReleaseTag
  )

  if ([Int64]$Release.id -le 0) {
    throw 'GitHub did not return a valid release id.'
  }
  if ([string]$Release.tag_name -cne $ReleaseTag) {
    throw "GitHub release $($Release.id) uses unexpected tag '$($Release.tag_name)'."
  }
  if ([bool]$Release.draft) {
    throw "Canonical GitHub release '$ReleaseTag' is still a draft; wait for the Mac release workflow."
  }
  if ([bool]$Release.prerelease) {
    throw "Canonical GitHub release '$ReleaseTag' is unexpectedly marked as a prerelease."
  }
  if ($null -eq $Release.published_at) {
    throw "Canonical GitHub release '$ReleaseTag' has no publication timestamp."
  }
}

function Assert-CanonicalReleaseAssets {
  param(
    [object]$Release,
    [string[]]$RequiredMacNames,
    [object[]]$LocalWindowsAssets,
    [bool]$AllowMissingWindows
  )

  $allowedNames = @($RequiredMacNames) + @($LocalWindowsAssets | ForEach-Object { $_.Name })
  foreach ($remoteAsset in @($Release.assets)) {
    $allowed = @($allowedNames | Where-Object { $_ -ceq [string]$remoteAsset.name })
    if ($allowed.Count -ne 1) {
      throw "Canonical GitHub release contains unexpected asset '$($remoteAsset.name)'."
    }
  }

  foreach ($macName in $RequiredMacNames) {
    $matches = @(@($Release.assets) | Where-Object { [string]$_.name -ceq $macName })
    if ($matches.Count -ne 1) {
      throw "Canonical GitHub release must contain exactly one Mac asset '$macName'."
    }
    $remote = $matches[0]
    if ([string]$remote.state -cne 'uploaded' -or [Int64]$remote.size -le 0) {
      throw "Canonical Mac asset '$macName' is incomplete."
    }
    if ([string]$remote.digest -notmatch '^sha256:[0-9a-f]{64}$') {
      throw "Canonical Mac asset '$macName' has no verified SHA-256 digest."
    }
  }

  $missingWindows = @()
  foreach ($localAsset in $LocalWindowsAssets) {
    $matches = @(
      @($Release.assets) | Where-Object { [string]$_.name -ceq $localAsset.Name }
    )
    if ($matches.Count -eq 0) {
      if ($AllowMissingWindows) {
        $missingWindows += $localAsset
        continue
      }
      throw "Canonical GitHub release is missing Windows asset '$($localAsset.Name)'."
    }
    if ($matches.Count -ne 1) {
      throw "Canonical GitHub release contains duplicate Windows assets named '$($localAsset.Name)'."
    }

    $remote = $matches[0]
    if ([string]$remote.state -cne 'uploaded') {
      throw "GitHub asset '$($localAsset.Name)' is not in the uploaded state."
    }
    if ([Int64]$remote.size -ne $localAsset.Size) {
      throw "GitHub asset '$($localAsset.Name)' size differs from the local release candidate."
    }
    if ([string]$remote.digest -cne $localAsset.Digest) {
      throw "GitHub asset '$($localAsset.Name)' digest differs from the local release candidate."
    }
  }

  return $missingWindows
}

function Assert-SoleMatchingRelease {
  param(
    [string]$Repository,
    [string]$ReleaseTag,
    [Int64]$ExpectedId
  )

  $matches = @(Get-MatchingReleases -Repository $Repository -ReleaseTag $ReleaseTag)
  if ($matches.Count -ne 1 -or [Int64]$matches[0].id -ne $ExpectedId) {
    throw "The GitHub release set for '$ReleaseTag' changed during upload."
  }
}

function Assert-RemoteTagCommit {
  param(
    [string]$Repository,
    [string]$ReleaseTag,
    [string]$ExpectedCommit
  )

  $remoteCommit = (Invoke-GhCapture -Arguments @(
    'api',
    "repos/$Repository/commits/$ReleaseTag",
    '--jq',
    '.sha'
  )).Trim()
  if ($remoteCommit -cne $ExpectedCommit) {
    throw "Remote tag '$ReleaseTag' resolves to '$remoteCommit', expected '$ExpectedCommit'."
  }
}

function Assert-ReleaseIsLatest {
  param(
    [string]$Repository,
    [Int64]$ExpectedId
  )

  $latest = Invoke-GhJson -Arguments @('api', "repos/$Repository/releases/latest")
  if ([Int64]$latest.id -ne $ExpectedId) {
    throw "GitHub latest release is $($latest.id), expected canonical release $ExpectedId."
  }
}

Write-Host '== Add Windows Assets to Canonical GitHub Release ==' -ForegroundColor Cyan
Ensure-Tool -Tool 'gh' -Hint 'Install GitHub CLI from https://cli.github.com and run gh auth login.'
if ($Repo -notmatch '^[0-9A-Za-z_.-]+/[0-9A-Za-z_.-]+$') {
  throw "Invalid GitHub repository '$Repo'; expected owner/name."
}

$ver = Get-AppVersion
$null = Get-WindowsInstallerFileName -Version $ver
$files = Get-ReleaseFiles -ReleaseVersion $ver
Assert-WindowsReleaseIdentity -Version $ver
Assert-WindowsInstallerSignature -InstallerPath $files.installer
Assert-WindowsUpdaterMetadataMatchesInstaller `
  -LatestYamlPath $files.latestYaml `
  -InstallerPath $files.installer `
  -Version $ver

$tag = "v$ver"
$headCommit = Get-ReleaseGitValue -Arguments @('rev-parse', 'HEAD')
$localWindowsAssets = @(Get-LocalWindowsAssets -Files $files)
$requiredMacNames = @(Get-RequiredMacAssetNames -ReleaseVersion $ver)
$releaseMutex = $null

Write-Host "Repo: $Repo"
Write-Host "Tag:  $tag"

try {
  $releaseMutex = Enter-WindowsReleaseMutex
  Exec-Gh -Arguments @('auth', 'status')

  $matches = @(Get-MatchingReleases -Repository $Repo -ReleaseTag $tag)
  if ($matches.Count -ne 1) {
    throw "Expected exactly one canonical GitHub release for '$tag'; found $($matches.Count)."
  }

  $release = Get-ReleaseById -Repository $Repo -ReleaseId ([Int64]$matches[0].id)
  Assert-CanonicalReleaseIdentity -Release $release -ReleaseTag $tag
  Assert-RemoteTagCommit -Repository $Repo -ReleaseTag $tag -ExpectedCommit $headCommit
  Assert-ReleaseIsLatest -Repository $Repo -ExpectedId ([Int64]$release.id)

  $missingWindows = @(
    Assert-CanonicalReleaseAssets `
      -Release $release `
      -RequiredMacNames $requiredMacNames `
      -LocalWindowsAssets $localWindowsAssets `
      -AllowMissingWindows $true
  )

  $missingPayloads = @($missingWindows | Where-Object { $_.Name -cne 'latest.yml' })
  if ($missingPayloads.Count -gt 0) {
    Write-Host 'Uploading missing immutable Windows payloads...' -ForegroundColor Cyan
    $uploadArguments = @('release', 'upload', $tag, '--repo', $Repo)
    foreach ($asset in $missingPayloads) {
      $uploadArguments += $asset.Path
    }
    Exec-Gh -Arguments $uploadArguments
  }

  # Re-read and verify the release before exposing its Windows manifest.
  $release = Get-ReleaseById -Repository $Repo -ReleaseId ([Int64]$release.id)
  $missingWindows = @(
    Assert-CanonicalReleaseAssets `
      -Release $release `
      -RequiredMacNames $requiredMacNames `
      -LocalWindowsAssets $localWindowsAssets `
      -AllowMissingWindows $true
  )
  $missingPayloads = @($missingWindows | Where-Object { $_.Name -cne 'latest.yml' })
  if ($missingPayloads.Count -ne 0) {
    throw 'Windows payload upload did not produce the complete required set.'
  }

  $missingManifests = @($missingWindows | Where-Object { $_.Name -ceq 'latest.yml' })
  if ($missingManifests.Count -gt 1) {
    throw 'Windows manifest inventory is ambiguous.'
  }
  if ($missingManifests.Count -eq 1) {
    Write-Host 'Uploading latest.yml as the final Windows pointer...' -ForegroundColor Cyan
    Exec-Gh -Arguments @(
      'release',
      'upload',
      $tag,
      '--repo',
      $Repo,
      $missingManifests[0].Path
    )
  }

  Assert-SoleMatchingRelease `
    -Repository $Repo `
    -ReleaseTag $tag `
    -ExpectedId ([Int64]$release.id)
  $release = Get-ReleaseById -Repository $Repo -ReleaseId ([Int64]$release.id)
  Assert-CanonicalReleaseIdentity -Release $release -ReleaseTag $tag
  $null = Assert-CanonicalReleaseAssets `
    -Release $release `
    -RequiredMacNames $requiredMacNames `
    -LocalWindowsAssets $localWindowsAssets `
    -AllowMissingWindows $false
  Assert-RemoteTagCommit -Repository $Repo -ReleaseTag $tag -ExpectedCommit $headCommit
  Assert-ReleaseIsLatest -Repository $Repo -ExpectedId ([Int64]$release.id)

  Write-Host 'Done. The canonical release now serves Mac and legacy Windows updaters.' -ForegroundColor Green
} finally {
  Exit-WindowsReleaseMutex -Mutex $releaseMutex
}

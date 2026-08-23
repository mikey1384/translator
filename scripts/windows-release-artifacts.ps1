Set-StrictMode -Version Latest

function Get-WindowsInstallerFileName {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Version
  )

  if ([string]::IsNullOrWhiteSpace($Version)) {
    throw 'A non-empty Windows release version is required.'
  }
  if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
    throw "Invalid Windows release version '$Version'."
  }
  return "Translator-Setup-$Version.exe"
}

function Get-WindowsInstallerPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $false)]
    [string]$DistPath = 'dist'
  )

  return (Join-Path -Path $DistPath -ChildPath (Get-WindowsInstallerFileName -Version $Version))
}

function Get-WindowsArtifactSha512Base64 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath
  )

  $stream = [System.IO.File]::OpenRead($FilePath)
  $sha512 = [System.Security.Cryptography.SHA512]::Create()
  try {
    return [Convert]::ToBase64String($sha512.ComputeHash($stream))
  } finally {
    $sha512.Dispose()
    $stream.Dispose()
  }
}

function Get-WindowsArtifactSha256Hex {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath
  )

  $stream = [System.IO.File]::OpenRead($FilePath)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha256.ComputeHash($stream)
    return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

function Assert-WindowsInstallerSignature {
  param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath
  )

  $signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Installer Authenticode signature is not valid: $($signature.Status) ($InstallerPath)"
  }
  $signerSubject = if ($signature.SignerCertificate) {
    [string]$signature.SignerCertificate.Subject
  } else {
    '(no signer certificate)'
  }
  if ($signerSubject -notmatch '(?:^|,\s*)CN=Stage5 Tools LLC(?:,|$)') {
    throw "Installer signer is not Stage5 Tools LLC: $signerSubject"
  }
}

function Assert-WindowsUpdaterMetadataMatchesInstaller {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LatestYamlPath,

    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [Parameter(Mandatory = $true)]
    [string]$Version
  )

  if (-not (Test-Path -LiteralPath $LatestYamlPath -PathType Leaf)) {
    throw "latest.yml not found at '$LatestYamlPath'."
  }
  if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    throw "Windows installer not found at '$InstallerPath'."
  }

  $expectedName = Get-WindowsInstallerFileName -Version $Version
  $actualName = [System.IO.Path]::GetFileName($InstallerPath)
  if ($actualName -cne $expectedName) {
    throw "Windows installer must use the canonical filename '$expectedName', got '$actualName'."
  }

  $yamlText = [System.IO.File]::ReadAllText($LatestYamlPath)
  $versionMatches = [Regex]::Matches($yamlText, '(?m)^version:\s*(\S+)\s*$')
  if ($versionMatches.Count -ne 1 -or $versionMatches[0].Groups[1].Value -cne $Version) {
    throw "latest.yml must declare requested version '$Version' exactly once."
  }

  $filesHeaders = [Regex]::Matches($yamlText, '(?m)^files:\s*$')
  if ($filesHeaders.Count -ne 1) {
    throw "latest.yml must contain exactly one files section; found $($filesHeaders.Count)."
  }

  $pathMatches = [Regex]::Matches($yamlText, '(?m)^path:\s*(\S+)\s*$')
  if ($pathMatches.Count -ne 1 -or $pathMatches[0].Groups[1].Value -cne $expectedName) {
    throw "latest.yml must reference '$expectedName' in exactly one top-level path field."
  }
  if ($pathMatches[0].Index -le $filesHeaders[0].Index) {
    throw 'latest.yml path must follow its files section.'
  }

  $filesSectionStart = $filesHeaders[0].Index + $filesHeaders[0].Length
  $filesSection = $yamlText.Substring(
    $filesSectionStart,
    $pathMatches[0].Index - $filesSectionStart
  )
  $urlMatches = [Regex]::Matches(
    $filesSection,
    '(?m)^\s*-\s+url:\s*(\S+)\s*$'
  )
  if ($urlMatches.Count -ne 1 -or $urlMatches[0].Groups[1].Value -cne $expectedName) {
    throw "latest.yml must contain exactly one updater entry for '$expectedName'."
  }

  $entryTail = $filesSection.Substring(
    $urlMatches[0].Index + $urlMatches[0].Length
  )
  $entryShaMatches = [Regex]::Matches($entryTail, '(?m)^\s+sha512:\s*(\S+)\s*$')
  if ($entryShaMatches.Count -ne 1) {
    throw "latest.yml entry for '$expectedName' must contain exactly one sha512 field."
  }

  $actualSha512 = Get-WindowsArtifactSha512Base64 -FilePath $InstallerPath
  if ($entryShaMatches[0].Groups[1].Value -cne $actualSha512) {
    throw "latest.yml sha512 mismatch for '$expectedName'."
  }

  $legacyShaMatches = [Regex]::Matches($yamlText, '(?m)^sha512:\s*(\S+)\s*$')
  if ($legacyShaMatches.Count -ne 1) {
    throw 'latest.yml must contain exactly one top-level sha512 compatibility field.'
  }
  if ($legacyShaMatches[0].Groups[1].Value -cne $actualSha512) {
    throw "latest.yml top-level sha512 mismatch for '$expectedName'."
  }

  $sizeFields = [Regex]::Matches($entryTail, '(?m)^\s+size:.*$')
  if ($sizeFields.Count -gt 1) {
    throw "latest.yml entry for '$expectedName' contains duplicate size fields."
  }
  if ($sizeFields.Count -eq 1) {
    $sizeMatch = [Regex]::Match($sizeFields[0].Value, '^\s+size:\s*(\d+)\s*$')
    if (-not $sizeMatch.Success) {
      throw "latest.yml entry for '$expectedName' contains an invalid size field."
    }
    $actualSize = (Get-Item -LiteralPath $InstallerPath).Length
    $declaredSize = [Int64]::Parse($sizeMatch.Groups[1].Value)
    if ($declaredSize -ne $actualSize) {
      throw "latest.yml size mismatch for '$expectedName': declared $declaredSize, actual $actualSize."
    }
  }
}

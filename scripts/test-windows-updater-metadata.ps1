Param(
  [Parameter(Mandatory = $false)]
  [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$artifactScript = Join-Path -Path $PSScriptRoot -ChildPath 'windows-release-artifacts.ps1'
if (-not (Test-Path -LiteralPath $artifactScript -PathType Leaf)) {
  throw "Windows release artifact helpers not found: $artifactScript"
}
. $artifactScript

if ([string]::IsNullOrWhiteSpace($Version)) {
  $packagePath = Join-Path -Path $repoRoot -ChildPath 'package.json'
  $Version = [string]((Get-Content -LiteralPath $packagePath | ConvertFrom-Json).version)
}

$distPath = Join-Path -Path $repoRoot -ChildPath 'dist'
$installerPath = Get-WindowsInstallerPath -Version $Version -DistPath $distPath
$latestYamlPath = Join-Path -Path $distPath -ChildPath 'latest.yml'

Assert-WindowsUpdaterMetadataMatchesInstaller `
  -LatestYamlPath $latestYamlPath `
  -InstallerPath $installerPath `
  -Version $Version

Write-Host "Windows updater metadata validation passed: $([System.IO.Path]::GetFileName($installerPath))"

Param(
  [Parameter(Mandatory = $false)]
  [string]$ExpectedCommit = 'HEAD',

  [Parameter(Mandatory = $false)]
  [string]$RepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  $RepoRoot = Split-Path -Parent $PSScriptRoot
}

$identityScript = Join-Path -Path $PSScriptRoot -ChildPath 'assert-windows-release-identity.ps1'
if (-not (Test-Path -LiteralPath $identityScript)) {
  throw "Windows release identity helper not found: $identityScript"
}

. $identityScript
Assert-WindowsReleaseWorktree -ExpectedCommit $ExpectedCommit -RepoRoot $RepoRoot
Write-Host "Windows release worktree matches $ExpectedCommit."

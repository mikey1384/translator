<#
  Inform Legacy Windows Users (One-Click)
  - Adds Windows updater assets to the published canonical GitHub release
  - Keeps the console open when launched outside VS Code

  Double-click wrapper: Inform-Windows-Legacy-Users.bat (in repo root)
#>

Param(
  [Parameter(Mandatory = $false)]
  [string]$Repo = 'mikey1384/translator',

  [Parameter(Mandatory = $false)]
  [switch]$NoPause
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$exitCode = 0
try {
  $bridgeScript = Join-Path -Path $PSScriptRoot -ChildPath 'bridge-windows-to-github.ps1'
  if (-not (Test-Path -LiteralPath $bridgeScript -PathType Leaf)) {
    throw "Canonical Windows GitHub bridge not found: $bridgeScript"
  }

  & $bridgeScript -Repo $Repo
} catch {
  $exitCode = 1
  Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
}

if (-not $NoPause -and $Host.Name -notlike '*Visual Studio Code*') {
  Read-Host 'Press Enter to exit'
}

exit $exitCode

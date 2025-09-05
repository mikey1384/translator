Param(
  [Parameter(Mandatory = $false)]
  [string]$Version,

  [Parameter(Mandatory = $false)]
  [string]$BaseUrl = 'https://downloads.stage5.tools/win',

  [Parameter(Mandatory = $false)]
  [string]$ZoneId,

  [Parameter(Mandatory = $false)]
  [string]$ApiToken,

  [Parameter(Mandatory = $false)]
  [switch]$IncludeVersioned
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PackageVersion {
  if ($Version -and $Version.Trim().Length -gt 0) { return $Version }
  if (Test-Path -LiteralPath 'package.json') {
    try {
      $pkg = Get-Content package.json | ConvertFrom-Json
      if ($pkg.version) { return [string]$pkg.version }
    } catch {}
  }
  throw "Version not provided and could not be read from package.json. Pass -Version x.y.z"
}

function Get-SecretsPath { return Join-Path -Path (Split-Path -Parent $PSCommandPath) -ChildPath '.secrets' }

function Get-SecretsFile { return Join-Path -Path (Get-SecretsPath) -ChildPath 'cloudflare.creds.xml' }

function Save-CloudflareCreds {
  param([string]$zoneId, [string]$apiToken)
  $dir = Get-SecretsPath
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $secure = ConvertTo-SecureString -String $apiToken -AsPlainText -Force
  $obj = [PSCustomObject]@{ ZoneId = $zoneId; ApiToken = $secure }
  $file = Get-SecretsFile
  $obj | Export-Clixml -Path $file -Force
}

function Load-CloudflareCreds {
  $file = Get-SecretsFile
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  try { return Import-Clixml -Path $file } catch { return $null }
}

function Ensure-CloudflareCreds {
  param([string]$z, [string]$t)
  # 1) Env vars
  if (-not $z) { $z = $env:CLOUDFLARE_ZONE_ID }
  if (-not $t) { $t = $env:CLOUDFLARE_API_TOKEN }

  # 2) Stored creds
  if (-not $z -or -not $t) {
    $stored = Load-CloudflareCreds
    if ($stored) {
      if (-not $z) { $z = $stored.ZoneId }
      if (-not $t -and $stored.ApiToken) {
        $t = [System.Net.NetworkCredential]::new('', $stored.ApiToken).Password
      }
    }
  }

  # 3) Prompt if still missing and persist for next time
  if (-not $z) { $z = Read-Host -Prompt 'Enter Cloudflare Zone ID' }
  if (-not $t) { $t = Read-Host -Prompt 'Enter Cloudflare API Token (Zone.Cache Purge permission)'}
  if (-not $z -or -not $t) { throw 'Cloudflare Zone ID and API Token are required' }

  # Persist for subsequent runs (user scope DPAPI via Export-Clixml)
  try { Save-CloudflareCreds -zoneId $z -apiToken $t } catch {}

  return @{ ZoneId = $z; ApiToken = $t }
}

function Build-PurgeUrls {
  param([string]$baseUrl, [string]$ver, [switch]$includeVersioned)
  $base = $baseUrl.TrimEnd('/')
  $latest = "$base/latest"
  $encodedInstaller = [System.Uri]::EscapeDataString("Translator Setup $ver.exe")
  $urls = @(
    "$latest/latest.yml",
    "$latest/$encodedInstaller",
    "$latest/$encodedInstaller.blockmap",
    "$latest/Translator-x64.exe",
    "$latest/Translator-x64.exe.sha256"
  )
  if ($includeVersioned) {
    $verBase = "$base/$ver"
    $urls += @(
      "$verBase/latest.yml",
      "$verBase/$encodedInstaller",
      "$verBase/$encodedInstaller.blockmap",
      "$verBase/Translator-x64.exe",
      "$verBase/Translator-x64.exe.sha256"
    )
  }
  return $urls
}

function Invoke-CloudflarePurge {
  param([string]$zoneId, [string]$apiToken, [string[]]$urls)
  $uri = "https://api.cloudflare.com/client/v4/zones/$zoneId/purge_cache"
  $headers = @{ Authorization = "Bearer $apiToken"; 'Content-Type' = 'application/json' }
  $body = @{ files = $urls } | ConvertTo-Json -Depth 4
  Write-Host "Purging cache for URLs (" $urls.Count "):" -ForegroundColor Cyan
  $urls | ForEach-Object { Write-Host "  - $_" }
  $resp = Invoke-RestMethod -Method POST -Uri $uri -Headers $headers -Body $body
  if (-not $resp.success) {
    throw "Cloudflare purge failed: $($resp | ConvertTo-Json -Depth 4)"
  }
  Write-Host "Purge requested successfully." -ForegroundColor Green
}

Write-Host "== Purge Cloudflare Cache (Windows latest) =="
$ver = Get-PackageVersion
Write-Host "Version: $ver"

$creds = Ensure-CloudflareCreds -z $ZoneId -t $ApiToken
$ZoneId = $creds.ZoneId
$ApiToken = $creds.ApiToken

$urls = Build-PurgeUrls -baseUrl $BaseUrl -ver $ver -includeVersioned:$IncludeVersioned
Invoke-CloudflarePurge -zoneId $ZoneId -apiToken $ApiToken -urls $urls

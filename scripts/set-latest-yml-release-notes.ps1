Param(
  [Parameter(Mandatory = $true)]
  [string]$LatestYamlPath,

  [Parameter(Mandatory = $true)]
  [string]$Version,

  [Parameter(Mandatory = $false)]
  [string]$ReleaseNotes,

  [Parameter(Mandatory = $false)]
  [string]$ReleaseNotesFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-TextFilePreferUtf8 {
  param([string]$path)

  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -eq 0) { return '' }

  # Honor BOM when present.
  if ($bytes.Length -ge 4) {
    if ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE -and $bytes[2] -eq 0x00 -and $bytes[3] -eq 0x00) {
      return [System.Text.Encoding]::UTF32.GetString($bytes, 4, $bytes.Length - 4)
    }
    if ($bytes[0] -eq 0x00 -and $bytes[1] -eq 0x00 -and $bytes[2] -eq 0xFE -and $bytes[3] -eq 0xFF) {
      return [System.Text.Encoding]::GetEncoding(12001).GetString($bytes, 4, $bytes.Length - 4)
    }
  }
  if ($bytes.Length -ge 3) {
    if ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
      return [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
    }
  }
  if ($bytes.Length -ge 2) {
    if ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
      return [System.Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2)
    }
    if ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) {
      return [System.Text.Encoding]::BigEndianUnicode.GetString($bytes, 2, $bytes.Length - 2)
    }
  }

  # No BOM: require valid UTF-8 so PowerShell codepage cannot corrupt text.
  $utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
  try {
    return $utf8Strict.GetString($bytes)
  } catch {
    throw "Release notes file is not valid UTF-8 (BOM-less or BOM). Save as UTF-8: $path"
  }
}

function Write-TextFileUtf8NoBom {
  param(
    [string]$path,
    [string]$content
  )

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Resolve-NotesText {
  param(
    [string]$inlineNotes,
    [string]$notesFile
  )

  if ($inlineNotes -and $inlineNotes.Trim().Length -gt 0) {
    return $inlineNotes
  }

  if ($notesFile -and $notesFile.Trim().Length -gt 0) {
    if (-not (Test-Path -LiteralPath $notesFile)) {
      throw "Release notes file not found: $notesFile"
    }
    return Read-TextFilePreferUtf8 -path $notesFile
  }

  throw 'Release notes are required. Pass -ReleaseNotes or -ReleaseNotesFile.'
}

if (-not (Test-Path -LiteralPath $LatestYamlPath)) {
  throw "latest.yml not found: $LatestYamlPath"
}

$raw = Read-TextFilePreferUtf8 -path $LatestYamlPath
$notes = Resolve-NotesText -inlineNotes $ReleaseNotes -notesFile $ReleaseNotesFile
$notes = $notes -replace "`r`n", "`n"
$notes = $notes.Trim()
if ($notes.Length -eq 0) {
  throw 'Release notes are empty after trimming.'
}

# Remove any existing top-level releaseName / releaseNotes entries first.
$raw = [regex]::Replace($raw, '(?m)^releaseName:.*\r?\n', '')
# Remove block-style releaseNotes first so we don't orphan indented lines.
$raw = [regex]::Replace(
  $raw,
  '(?m)^releaseNotes:\s*[|>][-+0-9]*\s*\r?\n(?:^[ \t][^\r\n]*\r?\n?)*',
  ''
)
# Then remove single-line releaseNotes entries.
$raw = [regex]::Replace($raw, '(?m)^releaseNotes:\s*(?![|>]).*\r?\n', '')

$indentedNotes = ($notes -split "`n" | ForEach-Object { "  $_" }) -join "`n"
$append = @"
releaseName: v$Version
releaseNotes: |-
$indentedNotes
"@

$normalized = $raw.TrimEnd()
$output = "$normalized`n$append`n"
Write-TextFileUtf8NoBom -path $LatestYamlPath -content $output

Write-Host "Injected release notes into $LatestYamlPath"

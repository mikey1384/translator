# PowerShell script to convert the application PNG into a valid multi-frame ICO.
param(
    [string]$InputPath = 'assets/icon.png',
    [string]$OutputPath = 'build/file_icon.ico'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "Converting $InputPath to $OutputPath..."

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$buildDir = Split-Path -Path $OutputPath -Parent
if ($buildDir -and -not (Test-Path -LiteralPath $buildDir)) {
    New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
}

Add-Type -AssemblyName System.Drawing

function Assert-IcoStructure {
    param(
        [string]$Path,
        [int[]]$ExpectedSizes
    )

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 6) { throw 'ICO output is shorter than its header.' }
    if ([BitConverter]::ToUInt16($bytes, 0) -ne 0 -or [BitConverter]::ToUInt16($bytes, 2) -ne 1) {
        throw 'ICO output has an invalid ICONDIR signature.'
    }

    $count = [BitConverter]::ToUInt16($bytes, 4)
    if ($count -ne $ExpectedSizes.Count) {
        throw "ICO frame count mismatch: expected $($ExpectedSizes.Count), found $count."
    }

    for ($index = 0; $index -lt $count; $index++) {
        $entryOffset = 6 + (16 * $index)
        $expectedDimension = if ($ExpectedSizes[$index] -eq 256) { 0 } else { $ExpectedSizes[$index] }
        if ($bytes[$entryOffset] -ne $expectedDimension -or $bytes[$entryOffset + 1] -ne $expectedDimension) {
            throw "ICO frame $index has the wrong dimensions."
        }

        $frameLength = [BitConverter]::ToUInt32($bytes, $entryOffset + 8)
        $frameOffset = [BitConverter]::ToUInt32($bytes, $entryOffset + 12)
        if ($frameLength -lt 8 -or $frameOffset + $frameLength -gt $bytes.Length) {
            throw "ICO frame $index points outside the output file."
        }

        $pngSignature = @(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
        for ($signatureIndex = 0; $signatureIndex -lt $pngSignature.Count; $signatureIndex++) {
            if ($bytes[$frameOffset + $signatureIndex] -ne $pngSignature[$signatureIndex]) {
                throw "ICO frame $index is not a PNG image."
            }
        }
    }
}

$sourceImage = $null
$writer = $null
$stream = $null

try {
    $sourceImage = [System.Drawing.Image]::FromFile($resolvedInput)
    $sizes = @(16, 32, 48, 64, 128, 256)
    $frames = @()

    foreach ($size in $sizes) {
        $bitmap = $null
        $graphics = $null
        $memory = $null

        try {
            $bitmap = [System.Drawing.Bitmap]::new(
                $size,
                $size,
                [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
            )
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.DrawImage($sourceImage, 0, 0, $size, $size)

            $memory = [System.IO.MemoryStream]::new()
            $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
            $frames += [PSCustomObject]@{
                Size = $size
                Bytes = $memory.ToArray()
            }
        } finally {
            if ($memory) { $memory.Dispose() }
            if ($graphics) { $graphics.Dispose() }
            if ($bitmap) { $bitmap.Dispose() }
        }
    }

    $stream = [System.IO.File]::Open(
        $OutputPath,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    $writer = [System.IO.BinaryWriter]::new($stream)

    # ICONDIR header.
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$frames.Count)

    $dataOffset = 6 + (16 * $frames.Count)
    foreach ($frame in $frames) {
        # A zero dimension represents 256 pixels in an ICO directory entry.
        $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
        $writer.Write([Byte]$dimension)
        $writer.Write([Byte]$dimension)
        $writer.Write([Byte]0)
        $writer.Write([Byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$frame.Bytes.Length)
        $writer.Write([UInt32]$dataOffset)
        $dataOffset += $frame.Bytes.Length
    }

    foreach ($frame in $frames) {
        $writer.Write([Byte[]]$frame.Bytes)
    }

    $writer.Flush()
    $writer.Dispose()
    $writer = $null
    Assert-IcoStructure -Path $OutputPath -ExpectedSizes $sizes
    Write-Host "Successfully created ICO file: $OutputPath"
} catch {
    throw "Failed to create a valid ICO file: $($_.Exception.Message)"
} finally {
    if ($writer) { $writer.Dispose() }
    elseif ($stream) { $stream.Dispose() }
    if ($sourceImage) { $sourceImage.Dispose() }
}

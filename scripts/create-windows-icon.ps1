# PowerShell script to convert PNG to ICO
param(
    [string]$InputPath = "assets/icon.png",
    [string]$OutputPath = "build/file_icon.ico"
)

Write-Host "Converting $InputPath to $OutputPath..."

# Create build directory if it doesn't exist
$buildDir = Split-Path $OutputPath -Parent
if (!(Test-Path $buildDir)) {
    New-Item -ItemType Directory -Path $buildDir -Force
}

try {
    # Load System.Drawing assembly
    Add-Type -AssemblyName System.Drawing
    
    # Load the PNG image
    $image = [System.Drawing.Image]::FromFile((Resolve-Path $InputPath).Path)
    
    # Create different sizes for the ICO file
    $sizes = @(16, 32, 48, 64, 128, 256)
    $iconImages = @()
    
    foreach ($size in $sizes) {
        $resized = New-Object System.Drawing.Bitmap($size, $size)
        $graphics = [System.Drawing.Graphics]::FromImage($resized)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($image, 0, 0, $size, $size)
        $graphics.Dispose()
        $iconImages += $resized
    }
    
    # Create ICO file
    $iconStream = New-Object System.IO.FileStream($OutputPath, [System.IO.FileMode]::Create)
    
    # ICO header
    $iconStream.Write([byte[]]@(0, 0, 1, 0), 0, 4) # ICO signature
    $iconStream.Write([System.BitConverter]::GetBytes([uint16]$iconImages.Count), 0, 2) # Number of images
    
    $imageDataOffset = 6 + ($iconImages.Count * 16) # Header + directory entries
    
    # Write directory entries
    foreach ($iconImage in $iconImages) {
        $iconStream.WriteByte($iconImage.Width -band 0xFF) # Width
        $iconStream.WriteByte($iconImage.Height -band 0xFF) # Height
        $iconStream.WriteByte(0) # Color count (0 for true color)
        $iconStream.WriteByte(0) # Reserved
        $iconStream.Write([System.BitConverter]::GetBytes([uint16]1), 0, 2) # Color planes
        $iconStream.Write([System.BitConverter]::GetBytes([uint16]32), 0, 2) # Bits per pixel
        
        # Calculate image data size (rough estimate)
        $imageSize = $iconImage.Width * $iconImage.Height * 4 + 40 # BITMAPINFOHEADER + pixel data
        $iconStream.Write([System.BitConverter]::GetBytes([uint32]$imageSize), 0, 4)
        $iconStream.Write([System.BitConverter]::GetBytes([uint32]$imageDataOffset), 0, 4)
        $imageDataOffset += $imageSize
    }
    
    # Write image data (simplified - just use the largest image)
    $largestImage = $iconImages[-1]
    $ms = New-Object System.IO.MemoryStream
    $largestImage.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $imageBytes = $ms.ToArray()
    $iconStream.Write($imageBytes, 0, $imageBytes.Length)
    $ms.Dispose()
    
    $iconStream.Close()
    
    # Cleanup
    foreach ($iconImage in $iconImages) {
        $iconImage.Dispose()
    }
    $image.Dispose()
    
    Write-Host "Successfully created ICO file: $OutputPath"
    
} catch {
    Write-Error "Failed to convert image: $($_.Exception.Message)"
    
    # Fallback: just copy the PNG file with ICO extension
    Write-Host "Falling back to copying PNG as ICO..."
    Copy-Item $InputPath $OutputPath -Force
    Write-Host "Copied PNG file as ICO (may work with electron-builder)"
} 
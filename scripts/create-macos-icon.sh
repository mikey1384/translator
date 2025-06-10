#!/bin/bash

# macOS App Icon Generator
# Creates a proper macOS app icon with rounded corners and styling

echo "🎨 Creating macOS-style app icon..."

# Create temp directory
mkdir -p temp_icon

# First, let's create a mask for rounded corners
# macOS app icons have approximately 22.37% corner radius (229px for 1024px icon)
CORNER_RADIUS=229

# Create the rounded rectangle mask using built-in tools
cat > temp_icon/create_mask.py << 'EOF'
from PIL import Image, ImageDraw
import sys

def create_rounded_mask(size, radius):
    # Create a mask with rounded corners
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size, size], radius, fill=255)
    return mask

# Create 1024x1024 mask
mask = create_rounded_mask(1024, 229)
mask.save('temp_icon/mask.png')
print("Mask created successfully")
EOF

# Check if Python with PIL is available
if python3 -c "import PIL" 2>/dev/null; then
    echo "✅ Using Python PIL for rounded corners..."
    python3 temp_icon/create_mask.py
    
    # Apply the mask to the original icon
    cat > temp_icon/apply_mask.py << 'EOF'
from PIL import Image

# Load original icon and mask
icon = Image.open('assets/icon.png').convert('RGBA')
mask = Image.open('temp_icon/mask.png').convert('L')

# Resize icon to 1024x1024 if needed
icon = icon.resize((1024, 1024), Image.Resampling.LANCZOS)

# Create output with transparent background
output = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))

# Apply mask
icon.putalpha(mask)
output.paste(icon, (0, 0), icon)

# Save the result
output.save('assets/icon_rounded.png')
print("Rounded icon created: assets/icon_rounded.png")
EOF
    
    python3 temp_icon/apply_mask.py
    
    # Replace the original icon
    mv assets/icon.png assets/icon_original.png
    mv assets/icon_rounded.png assets/icon.png
    
    echo "✅ Icon updated with rounded corners!"
    
else
    echo "❌ Python PIL not available. Let's try a different approach..."
    echo "🔧 Installing ImageMagick via Homebrew..."
    
    # Try to install ImageMagick
    if command -v brew >/dev/null 2>&1; then
        brew install imagemagick
        
        # Create rounded icon with ImageMagick
        convert assets/icon.png \
            \( +clone -alpha extract -draw 'fill black polygon 0,0 0,229 229,0 fill white circle 229,229 229,0' \
            \( +clone -flip \) -compose Multiply -composite \
            \( +clone -flop \) -compose Multiply -composite \
            \) -alpha off -compose CopyOpacity -composite assets/icon_rounded.png
        
        # Replace original
        mv assets/icon.png assets/icon_original.png
        mv assets/icon_rounded.png assets/icon.png
        
        echo "✅ Icon updated with ImageMagick!"
    else
        echo "❌ Neither Python PIL nor Homebrew found."
        echo "📋 Manual steps needed:"
        echo "1. Open assets/icon.png in a graphics editor (Photoshop, GIMP, Figma, etc.)"
        echo "2. Create a 1024x1024 canvas"
        echo "3. Add rounded rectangle with 229px corner radius"
        echo "4. Use it as a mask to clip your icon"
        echo "5. Export as PNG with transparency"
    fi
fi

# Clean up
rm -rf temp_icon

echo "🎉 Icon creation complete!"
echo "💡 Tip: For best results, ensure your icon design fills most of the rounded rectangle"
echo "    and has good contrast at small sizes." 
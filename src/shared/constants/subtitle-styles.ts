// Define the structure for a style object
interface SubtitleStyle {
  name: string; // Name of the style (e.g., "Default", "Boxed")
  fontName: string;
  fontSizePlaceholder: string; // We'll keep this for the helper function for now
  primaryColor: string; // ASS format: &HAABBGGRR
  secondaryColor: string; // Typically for Karaoke, often same as primary
  outlineColor: string;
  backColor: string; // Shadow or Box color
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  isStrikeout: boolean;
  scaleX: number; // Percentage
  scaleY: number; // Percentage
  spacing: number; // Extra space between characters
  angle: number; // Rotation
  borderStyle: 1 | 3 | 4; // 1: Outline + Shadow, 3: Opaque Box, 4: Outline + Opaque Box (like 3 but uses OutlineColour) - Use 1 for standard, 4 for boxed
  outlineSize: number; // Outline thickness
  shadowDepth: number; // Shadow distance
  alignment: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; // Numpad alignment (2=BottomCenter)
  marginLeft: number;
  marginRight: number;
  marginVertical: number; // Bottom margin for 1,2,3; Top for 7,8,9; VCenter for 4,5,6
  encoding: number; // Default is usually 1
}

const DEFAULT_FONT = 'Noto Sans';

// Refactored presets using the interface
export const SUBTITLE_STYLE_PRESETS: Record<string, SubtitleStyle> = {
  Default: {
    name: 'Default',
    fontName: DEFAULT_FONT,
    fontSizePlaceholder: '%FONTSIZE%',
    primaryColor: '&H00FFFFFF', // White
    secondaryColor: '&H000000FF', // Red (Often unused, copy primary or set specific if needed)
    outlineColor: '&H00000000', // Black
    backColor: '&H80000000', // Semi-transparent black (for shadow)
    isBold: true,
    isItalic: false,
    isUnderline: false,
    isStrikeout: false,
    scaleX: 100,
    scaleY: 100,
    spacing: 0,
    angle: 0,
    borderStyle: 1, // Outline + Shadow
    outlineSize: 1.5,
    shadowDepth: 0.5,
    alignment: 2, // BottomCenter
    marginLeft: 10,
    marginRight: 10,
    marginVertical: 15,
    encoding: 1,
  },
  Boxed: {
    name: 'Boxed',
    fontName: DEFAULT_FONT,
    fontSizePlaceholder: '%FONTSIZE%',
    primaryColor: '&H00FFFFFF', // White
    secondaryColor: '&H000000FF',
    outlineColor: '&H00000000', // Black (used for Box border)
    backColor: '&H33000000', // More transparent black (for Box background)
    isBold: true, // ASS string had -1, but might look better non-bold in a box? Let's keep true for now.
    isItalic: false,
    isUnderline: false,
    isStrikeout: false,
    scaleX: 100,
    scaleY: 100,
    spacing: 0,
    angle: 0,
    borderStyle: 4, // Use Style 4 for explicit box
    outlineSize: 1, // Outline controls box padding/border
    shadowDepth: 0, // Shadow controls box padding
    alignment: 2, // BottomCenter
    marginLeft: 10,
    marginRight: 10,
    marginVertical: 15, // Adjust if needed for box
    encoding: 1,
  },
  Classic: {
    name: 'Classic',
    fontName: DEFAULT_FONT,
    fontSizePlaceholder: '%FONTSIZE%',
    primaryColor: '&H0000FFFF', // Yellow
    secondaryColor: '&H000000FF',
    outlineColor: '&H00000000', // Black
    backColor: '&H80000000', // Semi-transparent black
    isBold: true,
    isItalic: false,
    isUnderline: false,
    isStrikeout: false,
    scaleX: 100,
    scaleY: 100,
    spacing: 0,
    angle: 0,
    borderStyle: 1,
    outlineSize: 2, // Slightly thicker outline
    shadowDepth: 1, // Slightly more shadow
    alignment: 2, // BottomCenter
    marginLeft: 10,
    marginRight: 10,
    marginVertical: 15,
    encoding: 1,
  },
  LineBox: {
    name: 'LineBox',
    fontName: DEFAULT_FONT,
    fontSizePlaceholder: '%FONTSIZE%',
    primaryColor: '&H00FFFFFF', // White
    secondaryColor: '&H000000FF',
    outlineColor: '&H00FFFFFF',
    backColor: '&H33000000', // Semi-transparent black
    isBold: true,
    isItalic: false,
    isUnderline: false,
    isStrikeout: false,
    scaleX: 100,
    scaleY: 100,
    spacing: 0,
    angle: 0,
    borderStyle: 3, // Keep as opaque box concept
    outlineSize: 0,
    shadowDepth: 0, // No shadow offset needed for box
    alignment: 2, // BottomCenter
    marginLeft: 10,
    marginRight: 10,
    marginVertical: 15,
    encoding: 1,
  },
};

export type SubtitleStylePresetKey = keyof typeof SUBTITLE_STYLE_PRESETS;

// Helper function to get the style line with font size replaced
export function getAssStyleLine(
  presetKey: SubtitleStylePresetKey,
  fontSize: number
): string {
  const style =
    SUBTITLE_STYLE_PRESETS[presetKey] || SUBTITLE_STYLE_PRESETS.Default;

  // Build the ASS string programmatically
  const parts = [
    `Style: ${style.name}`, // Use style.name or keep it 'Default' if needed by parser
    style.fontName,
    fontSize.toString(), // Insert the actual font size here
    style.primaryColor,
    style.secondaryColor,
    style.outlineColor,
    style.backColor,
    style.isBold ? '-1' : '0',
    style.isItalic ? '-1' : '0',
    style.isUnderline ? '-1' : '0',
    style.isStrikeout ? '-1' : '0',
    style.scaleX.toString(),
    style.scaleY.toString(),
    style.spacing.toString(),
    style.angle.toString(),
    style.borderStyle.toString(),
    style.outlineSize.toString(),
    style.shadowDepth.toString(),
    style.alignment.toString(),
    style.marginLeft.toString(),
    style.marginRight.toString(),
    style.marginVertical.toString(),
    style.encoding.toString(),
  ];

  return parts.join(',');
}

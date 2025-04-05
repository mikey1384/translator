// src/renderer/constants/subtitle-styles.ts

// Defines different V4+ Style lines for ASS subtitles
// Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding

// Note: Fontsize will be dynamically replaced.
// Note: Default font is set here, but can be overridden by user selection if implemented later.
const DEFAULT_FONT = 'Noto Sans';

export const ASS_STYLE_PRESETS = {
  Default: `Style: Default,${DEFAULT_FONT},%FONTSIZE%,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,1.5,0.5,2,10,10,15,1`,
  Boxed: `Style: Default,${DEFAULT_FONT},%FONTSIZE%,&H00FFFFFF,&H000000FF,&H00000000,&H33000000,1,0,0,0,100,100,0,0,4,1,0,2,10,10,30,1`,
  Classic: `Style: Default,${DEFAULT_FONT},%FONTSIZE%,&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,15,1`,
  Clean: `Style: Default,${DEFAULT_FONT},%FONTSIZE%,&H00FFFFFF,&H000000FF,&H00FFFFFF,&H00000000,-1,0,0,0,100,100,0,0,1,0.5,0,2,10,10,15,1`,
} as const;

export type AssStylePresetKey = keyof typeof ASS_STYLE_PRESETS;

// Helper function to get the style line with font size replaced
export function getAssStyleLine(
  presetKey: AssStylePresetKey,
  fontSize: number
): string {
  const template = ASS_STYLE_PRESETS[presetKey] || ASS_STYLE_PRESETS.Default;
  return template.replace('%FONTSIZE%', fontSize.toString());
}

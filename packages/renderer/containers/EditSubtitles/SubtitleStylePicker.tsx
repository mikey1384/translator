import React from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import {
  SUBTITLE_STYLE_PRESETS,
  SUBTITLE_STYLE_PRESET_ORDER,
  SubtitleStylePresetKey,
  subtitleStyleUsesLineBox,
} from '../../../shared/constants/subtitle-styles.js';
import {
  assColorToRgba,
  resolveSubtitleLineBoxStyle,
  resolveSubtitleRenderTheme,
} from '../../../shared/helpers/subtitle-style-util.js';
import { colors } from '../../styles.js';

const STYLE_LABELS: Record<string, string> = {
  Cinema: 'Cinema yellow',
  Clean: 'Clean',
  Highlight: 'Highlight',
  LineBox: 'Line box',
  Boxed: 'Boxed',
  Default: 'Outline',
  Classic: 'Bold yellow',
};

const gridStyles = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  gap: 10px;
  width: 100%;
`;

const tileStyles = css`
  display: grid;
  gap: 6px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  text-align: start;
  color: ${colors.textDim};
  font: inherit;
  font-size: 0.8rem;

  &:focus-visible > div {
    outline: 2px solid ${colors.primary};
    outline-offset: 2px;
  }
`;

const frameStyles = css`
  position: relative;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid ${colors.border};
  background:
    radial-gradient(120% 90% at 20% 10%, #5a6b7d 0%, transparent 60%),
    radial-gradient(90% 80% at 90% 30%, #8a6a4a 0%, transparent 65%),
    linear-gradient(180deg, #3b4450 0%, #1d2026 100%);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 9px;
  transition: border-color 0.15s ease;
`;

const selectedFrameStyles = css`
  border-color: ${colors.primary};
  box-shadow: 0 0 0 1px ${colors.primary};
`;

const selectedLabelStyles = css`
  color: ${colors.text};
`;

export function subtitleStyleLabel(
  t: (key: string, fallback: string) => string,
  preset: SubtitleStylePresetKey
): string {
  return t(`subtitleStyles.${preset}`, STYLE_LABELS[preset] ?? preset);
}

function StyleSample({ preset }: { preset: SubtitleStylePresetKey }) {
  const { t } = useTranslation();
  const theme = resolveSubtitleRenderTheme({
    displayFontSize: 14,
    stylePreset: preset,
    isMultiLine: false,
    videoWidthPx: 1920,
    videoHeightPx: 1080,
  });
  const color = assColorToRgba(SUBTITLE_STYLE_PRESETS[preset].primaryColor);
  const text = t('subtitleStyles.sample', 'Hello there');
  const boxed = theme.backgroundColor !== 'transparent';
  return (
    <span
      style={{
        color,
        fontFamily: theme.fontFamily,
        fontSize: 14,
        fontWeight: theme.fontWeight as number,
        letterSpacing: theme.letterSpacing,
        lineHeight: theme.lineHeight,
        textShadow: theme.textShadow,
        WebkitTextStroke: `${Math.min(theme.textStrokeWidthPx, 1.6)}px ${theme.textStrokeColor}`,
        paintOrder: 'stroke fill',
        whiteSpace: 'nowrap',
        ...(boxed
          ? {
              background: theme.backgroundColor,
              padding: '2px 8px',
              borderRadius: 4,
            }
          : null),
      }}
    >
      {subtitleStyleUsesLineBox(preset) ? (
        <span style={resolveSubtitleLineBoxStyle(theme)}>{text}</span>
      ) : (
        text
      )}
    </span>
  );
}

export default function SubtitleStylePicker({
  value,
  onChange,
}: {
  value: SubtitleStylePresetKey;
  onChange: (preset: SubtitleStylePresetKey) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={gridStyles}
      role="radiogroup"
      aria-label={t('editSubtitles.mergeControls.styleLabel')}
    >
      {SUBTITLE_STYLE_PRESET_ORDER.map(preset => {
        const selected = preset === value;
        return (
          <button
            key={preset}
            type="button"
            role="radio"
            aria-checked={selected}
            className={tileStyles}
            onClick={() => onChange(preset)}
          >
            <div
              className={`${frameStyles} ${selected ? selectedFrameStyles : ''}`}
            >
              <StyleSample preset={preset} />
            </div>
            <span className={selected ? selectedLabelStyles : undefined}>
              {subtitleStyleLabel(t, preset)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

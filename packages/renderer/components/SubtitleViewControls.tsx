import { useTranslation } from 'react-i18next';
import type { SubtitleDisplayMode } from '@shared-types/app';
import { useSubStore, useUIStore } from '../state';
import { logButton } from '../utils/logger';
import {
  lookSegmentStyles,
  lookValueStyles,
  sizeStepperStyles,
} from './workspace/workspace-styles';

const FONT_SIZE_RANGE = { min: 16, max: 72 };

/**
 * Translation / Original / Both, one click while watching. Shown only once
 * there is a translation to switch to. Used under the video and in the
 * player's own controls (so it works in full screen).
 */
export function SubtitleDisplaySwitch() {
  const { t } = useTranslation();
  const mode = useUIStore(s => s.subtitleDisplayMode);
  const setMode = useUIStore(s => s.setSubtitleDisplayMode);
  const hasTranslation = useSubStore(s =>
    s.order.some(id => !!s.segments[id]?.translation?.trim())
  );
  if (!hasTranslation) return null;
  const modes: Array<{ value: SubtitleDisplayMode; label: string }> = [
    {
      value: 'translation',
      label: t('workspace.showTranslation', 'Translation'),
    },
    { value: 'original', label: t('workspace.showOriginal', 'Original') },
    { value: 'dual', label: t('workspace.showBoth', 'Both') },
  ];
  return (
    <div
      className={lookSegmentStyles}
      role="radiogroup"
      aria-label={t('subtitles.displayModeLabel', 'Subtitle display')
        .replace(/[:：]\s*$/u, '')
        .trim()}
    >
      {modes.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={mode === option.value}
          onClick={() => {
            logButton('workspace_subtitle_display', { mode: option.value });
            setMode(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A− 38 A+: the same size the export burns in. */
export function SubtitleSizeStepper() {
  const { t } = useTranslation();
  const fontSize = useUIStore(s => s.baseFontSize);
  const setFontSize = useUIStore(s => s.setBaseFontSize);
  const size = Math.min(
    FONT_SIZE_RANGE.max,
    Math.max(FONT_SIZE_RANGE.min, fontSize || FONT_SIZE_RANGE.min)
  );
  const label = t('workspace.textSize', 'Text size');
  const nudge = (delta: number) => {
    const next = Math.min(
      FONT_SIZE_RANGE.max,
      Math.max(FONT_SIZE_RANGE.min, size + delta)
    );
    logButton('workspace_subtitle_size', { size: next });
    setFontSize(next);
  };
  return (
    <div className={sizeStepperStyles} role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`${label} −`}
        disabled={size <= FONT_SIZE_RANGE.min}
        onClick={() => nudge(-2)}
      >
        <span style={{ fontSize: '0.78em' }}>A</span>−
      </button>
      <span className={lookValueStyles} aria-live="polite">
        {size}
      </span>
      <button
        type="button"
        aria-label={`${label} +`}
        disabled={size >= FONT_SIZE_RANGE.max}
        onClick={() => nudge(2)}
      >
        <span style={{ fontSize: '1.05em' }}>A</span>+
      </button>
    </div>
  );
}

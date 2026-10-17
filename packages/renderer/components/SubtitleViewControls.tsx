import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubtitleDisplayMode } from '@shared-types/app';
import { useSubStore, useUIStore } from '../state';
import { logButton } from '../utils/logger';
import { formatUiInteger } from '../utils/formatNumbers';
import {
  lookSegmentStyles,
  lookValueStyles,
  sizeStepperStyles,
} from './workspace/workspace-styles';

// Steps stay inside what the export and the agent accept; the number shown
// is always the size actually used.
const FONT_SIZE_RANGE = { min: 12, max: 96 };
const SIZE_STEP = 2;

// Radios: arrows move the choice, and keys never reach the player's
// shortcuts (Space = play, arrows = seek).
function radioKeys<T>(
  event: KeyboardEvent<HTMLDivElement>,
  values: T[],
  current: T,
  select: (value: T) => void
) {
  const delta =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : 0;
  // Escape and Tab keep working as usual (close menus, move focus).
  if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
  if (!delta) return;
  event.preventDefault();
  const rtl =
    (event.key === 'ArrowRight' || event.key === 'ArrowLeft') &&
    getComputedStyle(event.currentTarget).direction === 'rtl';
  const index = Math.max(0, values.indexOf(current));
  const next =
    values[(index + (rtl ? -delta : delta) + values.length) % values.length];
  select(next);
  const buttons =
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  buttons[values.indexOf(next)]?.focus();
}

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
      onKeyDown={event =>
        radioKeys(
          event,
          modes.map(option => option.value),
          mode,
          value => {
            logButton('workspace_subtitle_display', { mode: value });
            setMode(value);
          }
        )
      }
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
          tabIndex={mode === option.value ? 0 : -1}
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
  const size = Math.round(fontSize) || FONT_SIZE_RANGE.min;
  const label = t('workspace.textSize', 'Text size');
  const nudge = (direction: 1 | -1) => {
    const next = Math.min(
      FONT_SIZE_RANGE.max,
      Math.max(FONT_SIZE_RANGE.min, size + direction * SIZE_STEP)
    );
    logButton('workspace_subtitle_size', { size: next });
    setFontSize(next);
  };
  return (
    <div
      className={sizeStepperStyles}
      role="group"
      aria-label={label}
      // Space/Enter press the button here, not play/pause.
      onKeyDown={event => {
        if (event.key !== 'Escape' && event.key !== 'Tab')
          event.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label={`${label} −`}
        // "A−"/"A+" is a glyph, not text: keep its order in RTL UIs.
        dir="ltr"
        disabled={size <= FONT_SIZE_RANGE.min}
        onClick={() => nudge(-1)}
      >
        <span style={{ fontSize: '0.78em' }}>A</span>−
      </button>
      <span className={lookValueStyles} aria-live="polite">
        {formatUiInteger(size)}
      </span>
      <button
        type="button"
        aria-label={`${label} +`}
        // "A−"/"A+" is a glyph, not text: keep its order in RTL UIs.
        dir="ltr"
        disabled={size >= FONT_SIZE_RANGE.max}
        onClick={() => nudge(1)}
      >
        <span style={{ fontSize: '1.05em' }}>A</span>+
      </button>
    </div>
  );
}

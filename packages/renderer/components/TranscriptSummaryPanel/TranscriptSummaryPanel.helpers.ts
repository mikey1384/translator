import type { TFunction } from 'i18next';
import type { TranscriptHighlight } from '@shared-types/app';
import {
  estimateSummaryCreditsFromChars,
  formatCredits as formatEstimatedCredits,
} from '../../utils/creditEstimates';
import { HighlightRenderError } from '../../utils/render-highlight';
import { getSourceVideoErrorMessage } from '../../utils/sourceVideoErrors';
import { formatDurationMinSec } from '../../utils/formatUnits';

export function estimateSummaryCredits(
  charCount: number,
  effortLevel: 'standard' | 'high'
): number {
  return estimateSummaryCreditsFromChars(charCount, effortLevel);
}

export function formatCredits(credits: number, locale?: string): string {
  return formatEstimatedCredits(credits, locale);
}

/**
 * A cut failure in the UI language. Coded render errors get their own text;
 * anything else (an encoder message from the main process) gets a plain
 * "couldn't cut" line instead of raw English.
 */
export function describeClipCutError(error: unknown, t: TFunction): string {
  if (error instanceof HighlightRenderError) {
    switch (error.code) {
      case 'busy':
        return t(
          'summary.clipError.busy',
          'Wait for the current job to finish, then cut the clip.'
        );
      case 'no-highlight':
        return t('summary.clipError.noHighlight', 'Choose a highlight first.');
      case 'editorial-single':
        return t(
          'summary.clipError.editorialSingle',
          'Cut each styled Short on its own, in Shorts Reframe.'
        );
      case 'editorial-stale':
        return t(
          'summary.clipError.editorialStale',
          'The subtitles in this Short changed. Open "Style this Short", check it and save, then cut again.'
        );
      case 'no-transcript':
        return t(
          'summary.clipError.noTranscript',
          'Open the subtitles for this video before cutting a clip.'
        );
      case 'no-cues':
        return t(
          'summary.clipError.noCues',
          'This part of the video has no subtitles.'
        );
      case 'untranslated':
        return t(
          'summary.clipError.untranslated',
          "Some lines in this clip aren't translated yet. Translate them, or set the subtitle display to show the original."
        );
      case 'subtitles-not-saved':
        return t(
          'summary.clipError.subtitlesNotSaved',
          "The clip was cut, but its subtitles couldn't be saved."
        );
      default:
        break;
    }
  }
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const sourceMessage = getSourceVideoErrorMessage(raw);
  if (sourceMessage) return sourceMessage;
  return t(
    'summary.clipError.generic',
    "Couldn't cut this clip from the video. Try again."
  );
}

export function getHighlightKey(h: TranscriptHighlight): string {
  if (typeof h.id === 'string' && h.id.trim().length > 0) {
    return h.id;
  }
  return buildHighlightRangeKey(h);
}

function buildHighlightRangeKey(h: TranscriptHighlight): string {
  const start = Number.isFinite(h.start) ? Math.round(h.start * 1000) : 0;
  const end = Number.isFinite(h.end) ? Math.round(h.end * 1000) : start;
  return `${start}-${end}`;
}

export type HighlightClipCutState = {
  status: 'idle' | 'cutting' | 'ready' | 'error' | 'cancelled';
  percent: number;
  error?: string;
  operationId?: string | null;
};

export function buildHighlightFilename(
  h: TranscriptHighlight,
  index: number
): string {
  const base = h.title ? slugify(h.title) : `highlight-${index + 1}`;
  const startSeconds = Math.max(0, Math.floor(h.start || 0));
  const startStamp = formatHHMMSS(startSeconds).replace(/:/g, '-');
  const safeBase = base || `highlight-${index + 1}`;
  return `${safeBase}-${startStamp}.mp4`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/giu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function translateStageLabel(stage: string, t: TFunction): string {
  const text = String(stage || '').toLowerCase();
  if (!text) return '';

  if (text.includes('preparing')) {
    return t('summary.status.preparing');
  }

  const selectingState =
    (text.includes('selecting') || text.includes('selection')) &&
    text.includes('highlight');
  if (selectingState) {
    return t('summary.status.selectingHighlights', 'Picking highlights…');
  }
  if (text.includes('cutting') && text.includes('highlight')) {
    const cutMatch = text.match(/cutting\s+highlight\s+(\d+)\s+of\s+(\d+)/);
    if (cutMatch) {
      return t('summary.status.cuttingHighlight', {
        current: Number(cutMatch[1]),
        total: Number(cutMatch[2]),
      });
    }
    return t('summary.status.cuttingHighlights', 'Cutting highlight clips…');
  }

  const chunkMatch = text.match(/section\s+(\d+)\s+of\s+(\d+)/);
  if (chunkMatch) {
    return t('summary.status.chunk', {
      current: Number(chunkMatch[1]),
      total: Number(chunkMatch[2]),
    });
  }
  if (text.includes('synthesizing')) {
    return t('summary.status.synthesizing');
  }
  if (text.includes('ready')) {
    return t('summary.status.ready');
  }
  if (text.includes('cancel')) {
    return t('summary.status.cancelled');
  }
  if (text.includes('error')) {
    return t('summary.status.error');
  }
  return stage;
}

export function toFileUrl(p: string): string {
  if (!p) return p;
  if (p.startsWith('file://')) return p;
  const normalized = p.replace(/\\/g, '/');

  if (/^[a-zA-Z]:\//.test(normalized)) {
    // Windows absolute path -> ensure triple slash
    return `file:///${encodeURI(normalized)}`;
  }

  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`;
  }

  return `file://${encodeURI(`/${normalized}`)}`;
}

function formatClock(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function clampRange(a: number, b: number): [number, number] {
  const s = Math.max(0, Math.floor(a || 0));
  return [s, Math.max(s, Math.floor(b || 0))];
}

/** "0:24–0:44". Always left-to-right; wrap it in <bdi dir="ltr"> in RTL. */
export function formatClockRange(a: number, b: number): string {
  const [s, e] = clampRange(a, b);
  return `${formatClock(s)}–${formatClock(e)}`;
}

/** How long the clip runs, in the UI language's units ("20s", "1m 5s"). */
export function formatClipLength(a: number, b: number, locale = 'en'): string {
  const [s, e] = clampRange(a, b);
  return formatDurationMinSec(e - s, locale);
}

/** "0:24–0:44 · 20s": where the clip sits and how long it runs. */
export function formatRange(a: number, b: number, locale = 'en'): string {
  return `${formatClockRange(a, b)} · ${formatClipLength(a, b, locale)}`;
}

export function formatHHMMSS(total: number): string {
  const hh = Math.floor(total / 3600)
    .toString()
    .padStart(2, '0');
  const mm = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const ss = Math.floor(total % 60)
    .toString()
    .padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

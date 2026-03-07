import type { TFunction } from 'i18next';
import type { TranscriptHighlight } from '@shared-types/app';
import {
  estimateSummaryCreditsFromChars,
  formatCredits as formatEstimatedCredits,
} from '../../utils/creditEstimates';

export function estimateSummaryCredits(
  charCount: number,
  effortLevel: 'standard' | 'high'
): number {
  return estimateSummaryCreditsFromChars(charCount, effortLevel);
}

export function formatCredits(credits: number): string {
  return formatEstimatedCredits(credits);
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
    .replace(/[^a-z0-9]+/gi, '-')
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
    return t(
      'summary.status.selectingHighlights',
      'Selecting highlight moments…'
    );
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

export function formatRange(a: number, b: number): string {
  const s = Math.max(0, Math.floor(a || 0));
  const e = Math.max(0, Math.floor(b || 0));
  return `${formatHHMMSS(s)} – ${formatHHMMSS(e)}`;
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

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import log from 'electron-log';
import type { FFmpegContext } from './ffmpeg-runner.js';
import { computeTranslationWordTimings } from './subtitle-processing/word-timings.js';
import type {
  StylizedCaptionStyle,
  TranscriptHighlight,
} from '@shared-types/app';

const KARAOKE_OVERRIDE_TAG =
  '{\\bord10\\blur0.4\\shad0\\1a&H00&\\2a&H00&\\3a&H00&\\4a&H20&\\1c&H202020&\\2c&H00FFB400&\\3c&H000000&\\4c&H202020&}';

interface WordTiming {
  start: number;
  end: number;
  word: string;
}

interface RenderStylizedHighlightOptions {
  ffmpeg: FFmpegContext;
  highlight: TranscriptHighlight;
  words: WordTiming[];
  operationId: string;
  signal?: AbortSignal;
  style?: StylizedCaptionStyle;
  progressCallback?: (update: { percent: number; stage: string }) => void;
}

const PLAY_RES_X = 1080;
const PLAY_RES_Y = 1920;

const DEFAULT_STYLE: Required<StylizedCaptionStyle> = {
  id: 'default',
  fontFamily: 'Noto Sans',
  fontSize: 80,
  primaryColor: '#202020',
  highlightColor: '#00B4FF',
  outlineColor: '#000000',
  backgroundColor: '#101010',
  alignment: 2,
  position: 'bottom',
};

export const DEFAULT_STYLIZED_CAPTION_STYLE: StylizedCaptionStyle = {
  ...DEFAULT_STYLE,
};

function escapeAssText(input: string): string {
  return input
    .replace(/\\/g, '\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r\n|\r|\n/g, '\\N');
}

function hexToAssColor(hex: string): string {
  const normalized = hex.replace('#', '').trim();
  if (!normalized) {
    return '&H00FFFFFF';
  }
  const v = normalized.toUpperCase();
  let aa = '00';
  let rr: string;
  let gg: string;
  let bb: string;
  if (v.length === 8) {
    aa = v.substring(0, 2);
    rr = v.substring(2, 4);
    gg = v.substring(4, 6);
    bb = v.substring(6, 8);
  } else {
    const value = v.padStart(6, '0');
    rr = value.substring(0, 2);
    gg = value.substring(2, 4);
    bb = value.substring(4, 6);
  }
  return `&H${aa}${bb}${gg}${rr}`;
}

function toAssTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600)
    .toString()
    .padStart(1, '0');
  const minutes = Math.floor((clamped % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(clamped % 60)
    .toString()
    .padStart(2, '0');
  const centiseconds = Math.floor((clamped % 1) * 100)
    .toString()
    .padStart(2, '0');
  return `${hours}:${minutes}:${secs}.${centiseconds}`;
}

function escapeFilterFilePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

/* eslint-disable no-useless-escape */
function buildKaraokeLine(
  words: Array<{ start: number; end: number; text: string }>,
  duration: number
): string {
  if (!words.length) {
    return escapeAssText('');
  }

  const parts: string[] = [];
  let previousEnd = 0;

  for (const word of words) {
    const gap = Math.max(0, word.start - previousEnd);
    if (gap > 0) {
      const gapCs = Math.max(1, Math.round(gap * 100));
      parts.push(`{\kf${gapCs}}\h`);
    }

    const wordDuration = Math.max(0, word.end - word.start);
    const durationCs = Math.max(1, Math.round(wordDuration * 100));
    parts.push(`{\kf${durationCs}}${escapeAssText(word.text)}`);
    previousEnd = Math.max(previousEnd, word.end);
  }

  const tail = Math.max(0, duration - previousEnd);
  if (tail > 0.01) {
    const tailCs = Math.max(1, Math.round(tail * 100));
    parts.push(`{\kf${tailCs}}\h`);
  }

  return parts.join('');
}
/* eslint-enable no-useless-escape */

function approximateWordsFromText(
  text: string,
  duration: number
): Array<{ start: number; end: number; text: string }> {
  const safeDuration = Math.max(0.01, duration);
  const normalized = (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const tokens = normalized.split(/(\s+)/);
  const totalWords = tokens.reduce((count, token) => {
    if (!token) return count;
    return /\S/.test(token) ? count + 1 : count;
  }, 0);
  if (totalWords === 0) return [];

  const step = safeDuration / totalWords;
  let cursor = 0;
  let whitespaceBuffer = '';
  const results: Array<{ start: number; end: number; text: string }> = [];

  for (const token of tokens) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      whitespaceBuffer += token;
      continue;
    }

    const start = cursor;
    cursor = Math.min(safeDuration, cursor + step);
    const combinedText = `${whitespaceBuffer}${token}`.replace(/\r/g, '');
    whitespaceBuffer = '';
    results.push({
      text: combinedText,
      start,
      end: cursor,
    });
  }

  if (results.length > 0) {
    const last = results[results.length - 1];
    last.end = safeDuration;
    if (whitespaceBuffer) {
      last.text += whitespaceBuffer.replace(/\r/g, '');
    }
  }

  return results;
}

function deriveStyle(
  style?: StylizedCaptionStyle
): Required<StylizedCaptionStyle> {
  return {
    ...DEFAULT_STYLE,
    ...(style ?? {}),
  };
}

function createAssScript(params: {
  style: Required<StylizedCaptionStyle>;
  dialogue: string;
  duration: number;
  margins?: { L?: number; R?: number; V?: number };
}): string {
  const { style, dialogue, duration } = params;
  const marginL = Math.max(0, Math.floor(params.margins?.L ?? 80));
  const marginR = Math.max(0, Math.floor(params.margins?.R ?? 80));
  const marginV = Math.max(0, Math.floor(params.margins?.V ?? 120));
  const alignment = style.alignment ?? 2;

  return (
    `[Script Info]\n` +
    `; Generated by highlight-stylizer\n` +
    `Title: Generated by highlight-stylizer\n` +
    `ScriptType: v4.00+\n` +
    `PlayResX: ${PLAY_RES_X}\n` +
    `PlayResY: ${PLAY_RES_Y}\n` +
    `WrapStyle: 2\n` +
    `ScaledBorderAndShadow: yes\n` +
    `YCbCr Matrix: TV.709\n\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Kinetic,${style.fontFamily},${style.fontSize},${hexToAssColor(
      style.primaryColor
    )},${hexToAssColor(style.highlightColor)},${hexToAssColor(
      style.outlineColor
    )},${hexToAssColor(style.backgroundColor)},0,0,0,0,100,100,0,0,1,4,0,${alignment},${marginL},${marginR},${marginV},1\n\n` +
    `[Events]\n` +
    `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
    `Dialogue: 0,${toAssTimestamp(0)},${toAssTimestamp(
      duration
    )},Kinetic,,${marginL},${marginR},${marginV},,${dialogue}\n`
  );
}

export function createAssFromSegments(params: {
  style: Required<StylizedCaptionStyle>;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    words?: Array<{ start: number; end: number; word: string }>;
  }>;
  playResX?: number;
  playResY?: number;
  margins?: { L?: number; R?: number; V?: number };
  isDual?: boolean;
  // When true, require per-word timings and render TikTok-style word window.
  // When false, render static lines (no throws) even if words are missing.
  karaoke?: boolean;
}): string {
  const WORD_WINDOW_SIZE = 3;
  const { style, segments } = params;
  const playX = Math.max(16, Math.floor(params.playResX ?? PLAY_RES_X));
  const playY = Math.max(16, Math.floor(params.playResY ?? PLAY_RES_Y));
  const marginL = Math.max(0, Math.floor(params.margins?.L ?? 80));
  const marginR = Math.max(0, Math.floor(params.margins?.R ?? 80));
  const marginV = Math.max(0, Math.floor(params.margins?.V ?? 120));
  const alignment = style.alignment ?? 2;

  const header =
    `[Script Info]\n` +
    `; Generated by highlight-stylizer\n` +
    `Title: Generated by highlight-stylizer\n` +
    `ScriptType: v4.00+\n` +
    `PlayResX: ${playX}\n` +
    `PlayResY: ${playY}\n` +
    `WrapStyle: 2\n` +
    `ScaledBorderAndShadow: yes\n` +
    `YCbCr Matrix: TV.709\n\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Kinetic,${style.fontFamily},${style.fontSize},${hexToAssColor(
      style.primaryColor
    )},${hexToAssColor(style.highlightColor)},${hexToAssColor(
      style.outlineColor
    )},${hexToAssColor(style.backgroundColor)},0,0,0,0,100,100,0,0,1,4,0,${alignment},${marginL},${marginR},${marginV},1\n\n` +
    `[Events]\n` +
    `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  const lines: string[] = [];
  let debugLogged = 0;

  function detectWordMode(
    segStart: number,
    segEnd: number,
    raw: Array<{ start: number; end: number; word: string }>
  ) {
    const duration = Math.max(0, segEnd - segStart);
    const TOL = 0.5;
    let absInRange = 0;
    let relInRange = 0;
    for (const w of raw) {
      const ws = Number(w.start);
      const we = Number(w.end);
      if (!Number.isFinite(ws) || !Number.isFinite(we)) continue;
      if (ws >= segStart - TOL && we <= segEnd + TOL && we >= ws) absInRange++;
      if (ws >= -TOL && we <= duration + TOL && we >= ws) relInRange++;
    }
    const treatAsAbsolute = absInRange >= relInRange && absInRange > 0;
    return { treatAsAbsolute, absInRange, relInRange };
  }

  // Decide if incoming per-word timings are absolute or relative to the segment.
  // Heuristic per segment: prefer the interpretation that yields the most in-range
  // timings inside [0, duration]. This supports both producers (absolute) and
  // our transcription pipeline (relative to segment start).
  function normalizeWordsForSegment(
    segStart: number,
    segEnd: number,
    raw: Array<{ start: number; end: number; word: string }>
  ): Array<{ start: number; end: number; text: string }> {
    const duration = Math.max(0, segEnd - segStart);
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const TOL = 0.5; // seconds, generous to account for rounding/noise

    let absInRange = 0;
    let relInRange = 0;
    for (const w of raw) {
      const ws = Number(w.start);
      const we = Number(w.end);
      if (!Number.isFinite(ws) || !Number.isFinite(we)) continue;
      // Absolute if roughly within [segStart, segEnd]
      if (ws >= segStart - TOL && we <= segEnd + TOL && we >= ws) absInRange++;
      // Relative if roughly within [0, duration]
      if (ws >= -TOL && we <= duration + TOL && we >= ws) relInRange++;
    }

    const treatAsAbsolute = absInRange >= relInRange && absInRange > 0;

    const mapped = raw
      .filter(w => Number.isFinite(w.start) && Number.isFinite(w.end))
      .map(w => {
        const baseStart = treatAsAbsolute ? Number(w.start) - segStart : Number(w.start);
        const baseEnd = treatAsAbsolute ? Number(w.end) - segStart : Number(w.end);
        const relStart = Math.max(0, baseStart);
        const relEnd = Math.max(0, baseEnd);
        return {
          start: Math.min(relStart, duration),
          end: Math.min(relEnd, duration),
          text: (w.word ?? '').replace(/\s+/g, ' '),
        };
      })
      .filter(w => w.text && w.end > 0 && w.start < duration)
      .sort((a, b) => a.start - b.start);

    return mapped;
  }
  for (const seg of segments.filter(
    s => Number.isFinite(s.start) && Number.isFinite(s.end)
  )) {
      const start = Math.max(0, Number(seg.start));
      const end = Math.max(start + 0.01, Number(seg.end));
      const duration = end - start;

      const baseText = seg.text || '';
      const isDual = !!params.isDual;
      let origLineRaw = baseText;
      let translationRaw = '';
      if (isDual) {
        const parts = baseText.split(/\r?\n/);
        origLineRaw = parts[0] || '';
        translationRaw = parts.length > 1 ? parts.slice(1).join('\n') : '';
      }
      const translationEsc = translationRaw ? escapeAssText(translationRaw) : '';
      const translationHasText = translationRaw.replace(/\s+/g, ' ').trim().length > 0;
      const rawWords = Array.isArray(seg.words) ? seg.words : [];
      const mode = detectWordMode(start, end, rawWords);
      if (debugLogged < 2) {
        try {
          const sample = rawWords
            .slice(0, 3)
            .map(w => `(${Number(w.start).toFixed(2)}-${Number(w.end).toFixed(2)} "${String(w.word || '').slice(0, 10)}")`)
            .join(', ');
          log.info(
            `[StylizeDebug] wordTiming mode=${mode.treatAsAbsolute ? 'absolute' : 'relative'} start=${start.toFixed(
              2
            )} end=${end.toFixed(2)} words=${rawWords.length} absIn=${mode.absInRange} relIn=${mode.relInRange} sample=${sample}`
          );
        } catch {}
        debugLogged++;
      }
      const normalizedWords = normalizeWordsForSegment(start, end, rawWords);

      const origTrimmed = origLineRaw.replace(/\s+/g, ' ').trim();

      if (params.karaoke && isDual) {
        // Dual-mode: animate both original and translation lines. Require per-line timings.
        const origSrc = (seg as any).origWords as Array<{ start: number; end: number; word: string }> | undefined;
        const transSrc = (seg as any).transWords as Array<{ start: number; end: number; word: string }> | undefined;
        const origTokens = Array.isArray(origSrc) && origSrc.length > 0
          ? origSrc
              .filter(w => Number.isFinite(w.start) && Number.isFinite(w.end))
              .map(w => ({ start: Math.max(0, Number(w.start)), end: Math.max(0, Number(w.end)), text: (w.word ?? '').replace(/\s+/g, ' ') }))
              .filter(w => w.text && w.end > 0 && w.start < duration)
              .sort((a, b) => a.start - b.start)
          : [];
        const transTokens = translationHasText && Array.isArray(transSrc) && transSrc.length > 0
          ? transSrc
              .filter(w => Number.isFinite(w.start) && Number.isFinite(w.end))
              .map(w => ({ start: Math.max(0, Number(w.start)), end: Math.max(0, Number(w.end)), text: (w.word ?? '').replace(/\s+/g, ' ') }))
              .filter(w => w.text && w.end > 0 && w.start < duration)
              .sort((a, b) => a.start - b.start)
          : [];
        const haveOrigTokens = origTokens.length > 0;
        if (!haveOrigTokens) {
          if (origTrimmed.length > 0) {
            throw new Error(
              `Stylize (word window) requires per-word timings on the original line; segment at ${toAssTimestamp(start)} is missing.`
            );
          }
        }
        if (translationHasText && transTokens.length === 0) {
          throw new Error(
            `Stylize (word window) requires per-word timings on the translation line; segment at ${toAssTimestamp(start)} is missing.`
          );
        }
        const emit = (tokens: any[], marginVOverride: number) => {
          for (let i = 0; i < tokens.length; i++) {
            const w = tokens[i];
            const startAbs = start + w.start;
            const nextStartRel = i + 1 < tokens.length ? tokens[i + 1].start : duration;
            const endAbs = start + Math.max(w.end, nextStartRel);
            const half = Math.floor((WORD_WINDOW_SIZE - 1) / 2);
            const winFrom = Math.max(0, i - half);
            const winTo = Math.min(tokens.length - 1, winFrom + WORD_WINDOW_SIZE - 1);
            const pieces: string[] = [];
            for (let j = winFrom; j <= winTo; j++) {
              const isCurrent = j === i;
              const token = escapeAssText(tokens[j].text);
              pieces.push(isCurrent ? `{\\1c&H00FFB400&}\\b1${token}\\b0{\\1c&H202020&}` : token);
            }
            const windowLine = pieces.join(' ');
            lines.push(`Dialogue: 0,${toAssTimestamp(startAbs)},${toAssTimestamp(endAbs)},Kinetic,,${marginL},${marginR},${marginVOverride},,${KARAOKE_OVERRIDE_TAG}${windowLine}`);
          }
        };
        // Original above, translation below (closer to bottom)
        const transMarginV = Math.max(0, marginV - Math.round(style.fontSize * 1.2));
        if (haveOrigTokens) {
          emit(origTokens, marginV);
        }
        if (translationHasText && transTokens.length > 0) {
          emit(transTokens, transMarginV);
        }
        continue;
      }

      if (normalizedWords.length > 0) {
        // Single-line karaoke (original or translation-only case)
        for (let i = 0; i < normalizedWords.length; i++) {
          const w = normalizedWords[i];
          const startAbs = start + w.start;
          const nextStartRel = i + 1 < normalizedWords.length ? normalizedWords[i + 1].start : duration;
          const endAbs = start + Math.max(w.end, nextStartRel);
          const half = Math.floor((WORD_WINDOW_SIZE - 1) / 2);
          const winFrom = Math.max(0, i - half);
          const winTo = Math.min(normalizedWords.length - 1, winFrom + WORD_WINDOW_SIZE - 1);
          const pieces: string[] = [];
          for (let j = winFrom; j <= winTo; j++) {
            const isCurrent = j === i;
            const token = escapeAssText(normalizedWords[j].text);
            pieces.push(isCurrent ? `{\\1c&H00FFB400&}\\b1${token}\\b0{\\1c&H202020&}` : token);
          }
          const windowLine = pieces.join(' ');
          lines.push(`Dialogue: 0,${toAssTimestamp(startAbs)},${toAssTimestamp(endAbs)},Kinetic,,${marginL},${marginR},${marginV},,${KARAOKE_OVERRIDE_TAG}${windowLine}`);
        }
      } else {
        // No word timings
        if (params.karaoke) {
          // Karaoke requested: hard fail to surface missing data early
          if (origTrimmed.length > 0 || translationEsc) {
            throw new Error(
              `Stylize (word window) requires word timings; segment at ${toAssTimestamp(start)} is missing word timings.`
            );
          }
          continue;
        } else {
          // Karaoke disabled: render static line instead of throwing
          const lineText = escapeAssText(origLineRaw);
          if (lineText || translationEsc) {
            const dialogueText = translationEsc
              ? `${KARAOKE_OVERRIDE_TAG}${lineText}\\N${translationEsc}`
              : `${KARAOKE_OVERRIDE_TAG}${lineText}`;
            lines.push(
              `Dialogue: 0,${toAssTimestamp(start)},${toAssTimestamp(
                end
              )},Kinetic,,${marginL},${marginR},${marginV},,${dialogueText}`
            );
          }
          continue;
        }
      }
    }

  return `${header}\n${lines.join('\n')}\n`;
}

// Tokenize helper tuned for broad coverage (Latin/CJK/Thai fallback)
// computeTranslationWordTimings is imported from subtitle-processing/word-timings

function normaliseWords(
  highlight: TranscriptHighlight,
  words: WordTiming[]
): Array<{ start: number; end: number; text: string }> {
  const start = Number.isFinite(highlight.start) ? Number(highlight.start) : 0;
  const end = Number.isFinite(highlight.end) ? Number(highlight.end) : start;
  const duration = Math.max(0, end - start);

  return words
    .map(word => ({
      text: word.word ?? '',
      start: Math.max(0, (word.start ?? 0) - start),
      end: Math.max(0, (word.end ?? 0) - start),
    }))
    .filter(w => w.text && w.end > 0 && w.start < duration)
    .map(w => ({
      text: w.text,
      start: Math.max(0, Math.min(w.start, duration)),
      end: Math.max(0, Math.min(w.end, duration)),
    }))
    .sort((a, b) => a.start - b.start);
}

export async function renderStylizedHighlight(
  options: RenderStylizedHighlightOptions
): Promise<string> {
  const {
    ffmpeg,
    highlight,
    words,
    operationId,
    signal,
    style,
    progressCallback,
  } = options;

  if (!highlight?.videoPath) {
    throw new Error('Highlight is missing video path.');
  }

  const highlightStart = Number.isFinite(highlight.start)
    ? Number(highlight.start)
    : 0;
  const highlightEnd = Number.isFinite(highlight.end)
    ? Number(highlight.end)
    : highlightStart;
  const highlightDuration = Math.max(0.01, highlightEnd - highlightStart);

  const resolvedStyle = deriveStyle(style);
  const relativeWords = normaliseWords(highlight, words);
  if (relativeWords.length === 0) {
    throw new Error('Stylize highlight requires word timings; none provided.');
  }

  const dialogue = `${KARAOKE_OVERRIDE_TAG}${buildKaraokeLine(
    relativeWords,
    highlightDuration
  )}`;

  progressCallback?.({
    percent: 10,
    stage: 'Preparing stylized captions',
  });

  const assContent = createAssScript({
    style: resolvedStyle,
    dialogue,
    duration: highlightDuration,
  });

  const assFilename = `stylized-${operationId}-${randomUUID()}.ass`;
  const assPath = path.join(ffmpeg.tempDir, assFilename);
  await fs.writeFile(assPath, assContent, 'utf8');

  const outputFilename = `stylized-${operationId}-${randomUUID()}.mp4`;
  const outputPath = path.join(ffmpeg.tempDir, outputFilename);

  const subtitlesFilter = `subtitles='${escapeFilterFilePath(assPath)}'`;

  const args = [
    '-y',
    '-i',
    path.resolve(highlight.videoPath),
    '-vf',
    subtitlesFilter,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    path.resolve(outputPath),
  ];

  await ffmpeg.run(args, {
    operationId: `${operationId}-stylize`,
    totalDuration: highlightDuration,
    progress: pct => {
      const bounded = Math.max(0, Math.min(100, pct));
      const scaled = 20 + bounded * 0.75;
      progressCallback?.({
        percent: Math.min(95, Math.round(scaled)),
        stage: 'Rendering stylized captions',
      });
    },
    signal,
  });

  progressCallback?.({
    percent: 100,
    stage: 'Stylized highlight ready',
  });

  try {
    await fs.unlink(assPath);
  } catch (err) {
    log.warn('[highlight-stylizer] Failed to clean up ASS file:', err);
  }

  return outputPath;
}

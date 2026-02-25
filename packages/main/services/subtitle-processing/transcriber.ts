import log from 'electron-log';
import crypto from 'crypto';
import { SrtSegment } from '@shared-types/app';
import {
  MAX_FINAL_SEGMENT_DURATION_SEC,
  MIN_FINAL_SEGMENT_DURATION_SEC,
  TARGET_FINAL_SEGMENT_DURATION_SEC,
  SPLIT_AT_PAUSE_GAP_SEC,
  MAX_CHARS_PER_SEGMENT,
  TARGET_CHARS_PER_SEGMENT,
  MAX_WORDS_PER_SEGMENT,
  TARGET_WORDS_PER_SEGMENT,
  MAX_CHARS_PER_SECOND,
} from './constants.js';
import fs from 'fs';
import { throwIfAborted, validateTimingInterval } from './utils.js';
import { ERROR_CODES } from '../../../shared/constants/index.js';
import {
  transcribe as transcribeAi,
  getActiveProvider as getActiveAiProvider,
} from '../ai-provider.js';

export async function transcribeChunk({
  chunkIndex,
  chunkPath,
  startTime,
  qualityMode,
  signal,
  operationId,
  promptContext,
}: {
  chunkIndex: number | string;
  chunkPath: string;
  startTime: number;
  qualityMode?: boolean;
  signal?: AbortSignal;
  operationId: string;
  promptContext?: string;
}): Promise<SrtSegment[]> {
  throwIfAborted(signal);

  try {
    log.debug(
      `[${operationId}] Sending chunk ${chunkIndex} (${(
        fs.statSync(chunkPath).size /
        (1024 * 1024)
      ).toFixed(2)} MB) to transcription API.`
    );

    const provider = getActiveAiProvider();
    log.debug(
      `[${operationId}] Using ${
        provider === 'openai' ? 'OpenAI BYO API' : 'Stage5 API'
      } for transcription`
    );
    // Retry up to 3 attempts on transient failures
    const maxAttempts = 3;
    let lastErr: any = null;
    let res: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      throwIfAborted(signal);
      try {
        res = await transcribeAi({
          filePath: chunkPath,
          promptContext,
          qualityMode,
          signal,
        });
        break; // success
      } catch (err: any) {
        // Propagate immediately on cancellation or insufficient credits
        if (
          err?.name === 'AbortError' ||
          err?.message === ERROR_CODES.INSUFFICIENT_CREDITS ||
          signal?.aborted
        ) {
          throw err;
        }
        lastErr = err;
        log.warn(
          `[${operationId}] Transcription attempt ${attempt}/${maxAttempts} failed for chunk ${chunkIndex}: ${String(
            err?.message || err
          )}`
        );
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, attempt * 300));
          continue;
        }
        // Exhausted retries; fall through to parsing with null response
      }
    }

    const segments = (res as any)?.segments as Array<any> | undefined;
    let words = ((res as any)?.words as Array<any> | undefined) || [];

    // Debug: log response keys to understand structure
    log.debug(
      `[transcribeChunk] Whisper response keys: ${Object.keys(res || {}).join(', ')}`
    );
    if (segments?.[0]) {
      log.debug(
        `[transcribeChunk] First segment keys: ${Object.keys(segments[0]).join(', ')}`
      );
      // Check if words are inside segments (OpenAI's nested format)
      if (Array.isArray(segments[0].words) && segments[0].words.length > 0) {
        log.debug(
          `[transcribeChunk] Found words INSIDE segments - extracting...`
        );
      }
    }

    // If no top-level words, try to extract from inside segments (OpenAI's format)
    if (words.length === 0 && Array.isArray(segments)) {
      const nestedWords: any[] = [];
      for (const seg of segments) {
        if (Array.isArray(seg.words)) {
          nestedWords.push(...seg.words);
        }
      }
      if (nestedWords.length > 0) {
        log.debug(
          `[transcribeChunk] Extracted ${nestedWords.length} words from inside segments`
        );
        words = nestedWords;
      }
    }

    log.debug(
      `[transcribeChunk] Whisper response: ${segments?.length ?? 0} segments, ${words.length} top-level words`
    );

    // Simple, Whisper-faithful mapping: one SRT segment per Whisper segment.
    const srtSegments: SrtSegment[] = [];
    if (Array.isArray(segments) && segments.length > 0) {
      let segIdx = 1;
      for (const seg of segments) {
        // Validate timing values from API response
        const timing = validateTimingInterval(seg?.start, seg?.end);
        if (!timing) {
          log.debug(
            `[transcribeChunk] Skipping segment with invalid timing: start=${seg?.start}, end=${seg?.end}`
          );
          continue;
        }

        const absStart = timing.start + startTime;
        const absEnd = timing.end + startTime;

        // Prefer Whisper-provided text, fall back to joining words inside the segment
        let text: string = (seg.text ?? '').trim();
        if (!text) {
          const BOUNDARY_TOL = 0.3; // seconds: include words that slightly cross segment edges
          const segWords = words.filter(
            (w: any) =>
              typeof w?.start === 'number' &&
              typeof w?.end === 'number' &&
              w.start >= timing.start - BOUNDARY_TOL &&
              w.end <= timing.end + BOUNDARY_TOL
          );
          text = segWords.map((w: any) => String(w.word ?? '')).join(' ');
          text = text.replace(/\s{2,}/g, ' ').trim();
        }

        // Map words to be relative to segment start (if provided)
        const BOUNDARY_TOL = 0.3; // seconds: include words that slightly cross segment edges
        const relWords = words
          .filter(
            (w: any) =>
              typeof w?.start === 'number' &&
              typeof w?.end === 'number' &&
              w.start >= timing.start - BOUNDARY_TOL &&
              w.end <= timing.end + BOUNDARY_TOL
          )
          .map((w: any) => ({
            ...w,
            start: (w.start ?? 0) - timing.start,
            end: (w.end ?? 0) - timing.start,
          }));

        // Build base segment and apply smart splitting using Whisper word timings
        const baseSeg: SrtSegment = {
          id: crypto.randomUUID(),
          index: segIdx, // temporary; reindexed below
          start: absStart,
          end: absEnd,
          original: text,
          avg_logprob: seg.avg_logprob,
          no_speech_prob: seg.no_speech_prob,
          words: relWords,
        } as SrtSegment;

        log.debug(
          `[transcribeChunk] Segment ${segIdx}: ${text.length} chars, ${relWords.length} words mapped, duration ${(absEnd - absStart).toFixed(2)}s`
        );

        const splitSegs = smartSplitByWords(baseSeg);
        log.debug(
          `[transcribeChunk] Segment ${segIdx} split into ${splitSegs.length} parts`
        );
        for (const ss of splitSegs) {
          ss.index = segIdx++;
          srtSegments.push(ss);
        }
      }
      return srtSegments;
    }

    // Fallback: if no segment list, build a single segment from all words
    if (words.length > 0) {
      const absStart = (words[0].start ?? 0) + startTime;
      const absEnd = (words[words.length - 1].end ?? 0) + startTime;
      const text = words
        .map((w: any) => String(w.word ?? ''))
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      const relWords = words.map((w: any) => ({
        ...w,
        start: (w.start ?? 0) - (words[0].start ?? 0),
        end: (w.end ?? 0) - (words[0].start ?? 0),
      }));
      return [
        {
          id: crypto.randomUUID(),
          index: 1,
          start: absStart,
          end: absEnd,
          original: text,
          words: relWords,
        } as SrtSegment,
      ];
    }

    // If no result after retries, return empty.
    if (lastErr) {
      log.error(
        `[${operationId}] Giving up after ${maxAttempts} attempts for chunk ${chunkIndex}:`,
        lastErr?.message || lastErr
      );
    }
    return [];
  } catch (error: any) {
    // If credits ran out, propagate a recognizable error upstream
    if (error?.message === ERROR_CODES.INSUFFICIENT_CREDITS) {
      throw error;
    }
    if (
      error?.message === ERROR_CODES.OPENAI_KEY_INVALID ||
      error?.message === ERROR_CODES.OPENAI_RATE_LIMIT
    ) {
      throw error;
    }
    if (
      error.name === 'AbortError' ||
      (error instanceof Error && error.message === 'Cancelled') ||
      signal?.aborted
    ) {
      log.info(
        `[${operationId}] Transcription for chunk ${chunkIndex} was cancelled.`
      );
      return [];
    } else {
      log.error(
        `[${operationId}] Error transcribing chunk ${chunkIndex}:`,
        error?.message || error
      );
      return [];
    }
  }
}

function joinWords(tokens: string[]): string {
  if (!tokens.length) return '';
  const hasCjk = tokens.some(t =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t)
  );
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] ?? '';
    if (!tok) continue;
    // No space before common trailing punctuation and closing brackets
    const noSpaceBefore = /^(?:[.,!?…:;%)\]}])/.test(tok);
    let needSpace = out.length > 0 && !noSpaceBefore;
    if (hasCjk) {
      const prev = out[out.length - 1] || '';
      const prevAscii = /[A-Za-z0-9]$/.test(prev);
      const nextAscii = /^[A-Za-z0-9]/.test(tok);
      // In CJK contexts, only space between ASCII words
      needSpace = out.length > 0 && !noSpaceBefore && prevAscii && nextAscii;
    }
    out += (needSpace ? ' ' : '') + tok;
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

function smartSplitByWords(seg: SrtSegment): SrtSegment[] {
  const totalDur = Math.max(0, seg.end - seg.start);
  const words = Array.isArray((seg as any).words)
    ? ((seg as any).words as any[])
    : [];

  // If no words available, can't do smart splitting
  if (words.length === 0) {
    return [seg];
  }

  // Calculate total text length for density check
  const totalText = joinWords(words.map(w => String(w.word ?? '')));
  const totalChars = totalText.length;
  const totalWordCount = words.length;

  // Check if segment is already within ALL limits
  const withinDuration = totalDur <= MAX_FINAL_SEGMENT_DURATION_SEC;
  const withinChars = totalChars <= MAX_CHARS_PER_SEGMENT;
  const withinWords = totalWordCount <= MAX_WORDS_PER_SEGMENT;
  const withinReadingSpeed =
    totalDur > 0 ? totalChars / totalDur <= MAX_CHARS_PER_SECOND : true;

  if (withinDuration && withinChars && withinWords && withinReadingSpeed) {
    return [seg];
  }

  const makeSub = (startIdx: number, endIdx: number): SrtSegment => {
    const first = words[startIdx];
    const last = words[endIdx];
    const absStart = seg.start + (first?.start ?? 0);
    const absEnd = seg.start + (last?.end ?? 0);
    const relSlice = words.slice(startIdx, endIdx + 1);
    const text = joinWords(relSlice.map(w => String(w.word ?? '')));
    const remap = relSlice.map(w => ({
      ...w,
      start: (w.start ?? 0) - (first?.start ?? 0),
      end: (w.end ?? 0) - (first?.start ?? 0),
    }));
    return {
      ...seg,
      id: crypto.randomUUID(),
      start: absStart,
      end: absEnd,
      original: text,
      words: remap as any,
    } as SrtSegment;
  };

  // Helper to calculate char count for a range of words
  const getCharCount = (fromIdx: number, toIdx: number): number => {
    const slice = words.slice(fromIdx, toIdx + 1);
    return joinWords(slice.map(w => String(w.word ?? ''))).length;
  };

  const out: SrtSegment[] = [];
  let i = 0;
  while (i < words.length) {
    let j = i;
    let lastGoodCut = -1; // strong punctuation .?!…:;
    let lastPauseCut = -1; // comma or pause gap

    const baseStart = words[i].start ?? 0;
    while (j < words.length) {
      const curDur = (words[j].end ?? 0) - baseStart;
      const curWordCount = j - i + 1;
      const curCharCount = getCharCount(i, j);
      const curReadingSpeed = curDur > 0 ? curCharCount / curDur : 0;

      const token = String(words[j].word ?? '');
      if (/[.?!…:;]$/.test(token)) lastGoodCut = j;
      else if (/,+$/.test(token)) lastPauseCut = j;

      if (j + 1 < words.length) {
        const gap = (words[j + 1].start ?? 0) - (words[j].end ?? 0);
        if (gap >= SPLIT_AT_PAUSE_GAP_SEC) lastPauseCut = j;
      }

      // Check all target thresholds (prefer to split at natural boundaries)
      const durationTargetReached = curDur >= TARGET_FINAL_SEGMENT_DURATION_SEC;
      const charTargetReached = curCharCount >= TARGET_CHARS_PER_SEGMENT;
      const wordTargetReached = curWordCount >= TARGET_WORDS_PER_SEGMENT;
      const targetReached =
        durationTargetReached || charTargetReached || wordTargetReached;

      // Check all hard limits (must split)
      const durationMaxReached = curDur >= MAX_FINAL_SEGMENT_DURATION_SEC;
      const charMaxReached = curCharCount >= MAX_CHARS_PER_SEGMENT;
      const wordMaxReached = curWordCount >= MAX_WORDS_PER_SEGMENT;
      // Only check reading speed for segments >= 1.5s to avoid spurious splits on brief fast speech
      const readingSpeedExceeded =
        curDur >= 1.5 && curReadingSpeed > MAX_CHARS_PER_SECOND;
      const maxReached =
        durationMaxReached ||
        charMaxReached ||
        wordMaxReached ||
        readingSpeedExceeded;

      if (targetReached || maxReached) {
        let cut = -1;
        if (lastGoodCut >= i) cut = lastGoodCut;
        else if (lastPauseCut >= i) cut = lastPauseCut;
        else cut = j;

        // Avoid too-short segments (but only if we haven't hit a hard limit)
        const cutDur = (words[cut].end ?? 0) - baseStart;
        if (
          !maxReached &&
          cutDur < MIN_FINAL_SEGMENT_DURATION_SEC &&
          cut + 1 < words.length
        ) {
          cut = Math.min(words.length - 1, cut + 1);
        }

        out.push(makeSub(i, cut));
        i = cut + 1;
        break;
      }
      j++;
    }

    if (j >= words.length) {
      out.push(makeSub(i, words.length - 1));
      break;
    }
  }

  return out.length ? out : [seg];
}

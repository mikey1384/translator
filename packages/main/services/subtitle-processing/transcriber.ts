import log from 'electron-log';
import crypto from 'crypto';
import { SrtSegment } from '@shared-types/app';
import {
  MAX_FINAL_SEGMENT_DURATION_SEC,
  MIN_FINAL_SEGMENT_DURATION_SEC,
  TARGET_FINAL_SEGMENT_DURATION_SEC,
  SPLIT_AT_PAUSE_GAP_SEC,
} from './constants.js';
import fs from 'fs';
import { throwIfAborted } from './utils.js';
import { transcribe as transcribeAi } from '../ai-provider.js';
import path from 'path';

export async function transcribeChunk({
  chunkIndex,
  chunkPath,
  startTime,
  signal,
  operationId,
  promptContext,
}: {
  chunkIndex: number | string;
  chunkPath: string;
  startTime: number;
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

    log.debug(`[${operationId}] Using Stage5 API for transcription`);
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
          signal,
        });
        try {
          const rawOut = {
            operationId,
            chunkIndex,
            startTime,
            providerSegments: Array.isArray((res as any)?.segments)
              ? (res as any).segments.length
              : 0,
            providerWords: Array.isArray((res as any)?.words)
              ? (res as any).words.length
              : 0,
            sampleSegment: (res as any)?.segments?.[0] || null,
            sampleWords: ((res as any)?.words || []).slice(0, 10) || [],
          } as any;
          const debugPath = path.join(
            path.dirname(chunkPath),
            `${operationId}_raw_${String(chunkIndex)}.json`
          );
          fs.writeFileSync(debugPath, JSON.stringify(rawOut, null, 2), 'utf8');
          log.info(
            `[${operationId}] Raw transcription debug written: ${debugPath} (segs=${rawOut.providerSegments}, words=${rawOut.providerWords})`
          );
        } catch (e) {
          log.warn(`[${operationId}] Failed to write raw transcription debug:`, e);
        }
        break; // success
      } catch (err: any) {
        // Propagate immediately on cancellation or insufficient credits
        if (
          err?.name === 'AbortError' ||
          err?.message === 'insufficient-credits' ||
          /Insufficient credits/i.test(String(err?.message || err)) ||
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
    const words = ((res as any)?.words as Array<any> | undefined) || [];

    // Simple, Whisper-faithful mapping: one SRT segment per Whisper segment.
    const srtSegments: SrtSegment[] = [];
    if (Array.isArray(segments) && segments.length > 0) {
      let segIdx = 1;
      for (const seg of segments) {
        // Basic quality gate (still permissive to match Whisper closely)
        const ok =
          typeof seg?.start === 'number' &&
          typeof seg?.end === 'number' &&
          seg.end > seg.start;
        if (!ok) continue;

        const absStart = (seg.start ?? 0) + startTime;
        const absEnd = (seg.end ?? 0) + startTime;

        // Prefer Whisper-provided text, fall back to joining words inside the segment
        let text: string = (seg.text ?? '').trim();
        const relWords = collectSegmentWords({
          segment: seg,
          globalWords: words,
          segStart: seg.start ?? 0,
          segEnd: seg.end ?? 0,
        });
        if (!text && relWords.length) {
          text = relWords.map(w => w.word).join(' ');
        }
        text = text.replace(/\s{2,}/g, ' ').trim();

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
          origWords: relWords.map(w => ({ ...w })),
        } as SrtSegment;

        const splitSegs = smartSplitByWords(baseSeg);
        for (const ss of splitSegs) {
          ss.index = segIdx++;
          srtSegments.push(ss);
        }
      }
      try {
        const withWords = srtSegments.filter((s: any) => Array.isArray(s?.origWords) && s.origWords.length > 0).length;
        const dbg = {
          operationId,
          chunkIndex,
          mappedSegments: srtSegments.length,
          withOrigWords: withWords,
          sample: srtSegments.slice(0, 3).map(s => ({ start: s.start, end: s.end, ow: (s as any).origWords?.length || 0 })),
        } as any;
        const debugPath = path.join(
          path.dirname(chunkPath),
          `${operationId}_mapped_${String(chunkIndex)}.json`
        );
        fs.writeFileSync(debugPath, JSON.stringify(dbg, null, 2), 'utf8');
        log.info(
          `[${operationId}] Mapped transcription debug: segs=${dbg.mappedSegments}, withOrigWords=${dbg.withOrigWords}`
        );
      } catch (e) {
        log.warn(`[${operationId}] Failed to write mapped transcription debug:`, e);
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
      const baseSeg: SrtSegment = {
        id: crypto.randomUUID(),
        index: 1,
        start: absStart,
        end: absEnd,
        original: text,
        words: relWords,
        origWords: relWords.map(w => ({ ...w })),
      } as SrtSegment;
      const splitFallback = smartSplitByWords(baseSeg).map((seg, idx) => ({
        ...seg,
        index: idx + 1,
      }));
      return splitFallback.length ? splitFallback : [baseSeg];
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
    if (
      error?.message === 'insufficient-credits' ||
      /Insufficient credits/i.test(String(error?.message || error))
    ) {
      throw error;
    }
    if (
      error?.message === 'openai-key-invalid' ||
      error?.message === 'openai-rate-limit'
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
  if (totalDur <= MAX_FINAL_SEGMENT_DURATION_SEC || words.length === 0) {
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
      origWords: remap as any,
    } as SrtSegment;
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

      const token = String(words[j].word ?? '');
      if (/[.?!…:;]$/.test(token)) lastGoodCut = j;
      else if (/,+$/.test(token)) lastPauseCut = j;

      if (j + 1 < words.length) {
        const gap = (words[j + 1].start ?? 0) - (words[j].end ?? 0);
        if (gap >= SPLIT_AT_PAUSE_GAP_SEC) lastPauseCut = j;
      }

      const targetReached = curDur >= TARGET_FINAL_SEGMENT_DURATION_SEC;
      const maxReached = curDur >= MAX_FINAL_SEGMENT_DURATION_SEC;
      if (targetReached || maxReached) {
        let cut = -1;
        if (lastGoodCut >= i) cut = lastGoodCut;
        else if (lastPauseCut >= i) cut = lastPauseCut;
        else cut = j;

        // Avoid too-short segments
        const cutDur = (words[cut].end ?? 0) - baseStart;
        if (cutDur < MIN_FINAL_SEGMENT_DURATION_SEC && cut + 1 < words.length) {
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
function normalizeWordEntry(entry: any): { start: number; end: number; word: string } | null {
  if (!entry) return null;
  const rawWord =
    entry.word ?? entry.text ?? entry.token ?? entry.content ?? entry.value ?? '';
  if (!rawWord || !String(rawWord).trim()) return null;
  const rawStart =
    entry.start ??
    entry.start_time ??
    entry.from ??
    entry.offset ??
    entry.time ??
    entry.begin ??
    null;
  const rawEnd =
    entry.end ??
    entry.end_time ??
    entry.to ??
    entry.offset_end ??
    entry.time_end ??
    entry.finish ??
    null;
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;
  const start = Number(rawStart);
  const end = Number(rawEnd);
  if (!(end > start)) return null;
  return {
    start,
    end,
    word: String(rawWord).replace(/\s+/g, ' ').trim(),
  };
}

function collectSegmentWords(options: {
  segment: any;
  globalWords: any[];
  segStart: number;
  segEnd: number;
}): Array<{ start: number; end: number; word: string }> {
  const { segment, globalWords, segStart, segEnd } = options;
  const out: Array<{ start: number; end: number; word: string }> = [];
  const localLists = [segment?.words, segment?.tokens, segment?.word_timestamps];
  for (const list of localLists) {
    if (!Array.isArray(list) || !list.length) continue;
    const normalized = list
      .map(normalizeWordEntry)
      .filter((x): x is { start: number; end: number; word: string } => !!x);
    if (!normalized.length) continue;
    const duration = Math.max(0, segEnd - segStart);
    const treatAsAbsolute = normalized.some(
      w => w.start >= duration + 0.25 || w.end >= duration + 0.25
    );
    const baseOffset = treatAsAbsolute ? segStart : 0;
    for (const w of normalized) {
      const relStart = w.start - baseOffset;
      const relEnd = w.end - baseOffset;
      if (relEnd <= relStart) continue;
      out.push({ start: relStart, end: relEnd, word: w.word });
    }
    if (out.length) return out;
  }

  const tol = 0.35;
  const normalizedGlobals = Array.isArray(globalWords)
    ? globalWords
        .map(normalizeWordEntry)
        .filter((x): x is { start: number; end: number; word: string } => !!x)
    : [];
  for (const w of normalizedGlobals) {
    if (
      w.start >= segStart - tol &&
      w.end <= segEnd + tol &&
      w.end > segStart - tol
    ) {
      out.push({ start: w.start - segStart, end: w.end - segStart, word: w.word });
    }
  }
  return out;
}

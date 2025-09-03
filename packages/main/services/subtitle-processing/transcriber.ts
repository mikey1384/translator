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
import * as stage5Client from '../stage5-client.js';

export async function transcribeChunk({
  chunkIndex,
  chunkPath,
  startTime,
  signal,
  operationId,
  promptContext,
  language,
}: {
  chunkIndex: number | string;
  chunkPath: string;
  startTime: number;
  signal?: AbortSignal;
  operationId: string;
  promptContext?: string;
  language?: string;
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
    const res: any = await stage5Client.transcribe({
      filePath: chunkPath,
      language,
      promptContext,
      signal,
    });

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
        if (!text) {
          const segWords = words.filter(
            (w: any) =>
              typeof w?.start === 'number' &&
              typeof w?.end === 'number' &&
              w.start >= (seg.start ?? 0) - 1e-3 &&
              w.end <= (seg.end ?? 0) + 1e-3
          );
          text = segWords.map((w: any) => String(w.word ?? '')).join(' ');
          text = text.replace(/\s{2,}/g, ' ').trim();
        }

        // Map words to be relative to segment start (if provided)
        const relWords = words
          .filter(
            (w: any) =>
              typeof w?.start === 'number' &&
              typeof w?.end === 'number' &&
              w.start >= (seg.start ?? 0) - 1e-3 &&
              w.end <= (seg.end ?? 0) + 1e-3
          )
          .map((w: any) => ({
            ...w,
            start: (w.start ?? 0) - (seg.start ?? 0),
            end: (w.end ?? 0) - (seg.start ?? 0),
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

        const splitSegs = smartSplitByWords(baseSeg);
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

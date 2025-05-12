import OpenAI from 'openai';
import log from 'electron-log';
import crypto from 'crypto';
import { AI_MODELS } from '../../../shared/constants/index.js';
import { createFileFromPath } from './openai-client.js';
import { callAIModel } from './openai-client.js';
import { SrtSegment } from '@shared-types/app';
import {
  NO_SPEECH_PROB_THRESHOLD,
  AVG_LOGPROB_THRESHOLD,
} from './constants.js';
import fs from 'fs';

export async function transcribeChunk({
  chunkIndex,
  chunkPath,
  startTime,
  signal,
  openai,
  operationId,
  promptContext,
}: {
  chunkIndex: number;
  chunkPath: string;
  startTime: number;
  signal?: AbortSignal;
  openai: OpenAI;
  operationId: string;
  promptContext?: string;
}): Promise<SrtSegment[]> {
  if (signal?.aborted) {
    log.info(
      `[${operationId}] Transcription for chunk ${chunkIndex} cancelled before API call.`
    );
    throw new Error('Cancelled');
  }

  let fileStream: fs.ReadStream;
  try {
    fileStream = createFileFromPath(chunkPath);
  } catch (streamError: any) {
    log.error(
      `[${operationId}] Failed to create read stream for chunk ${chunkIndex} (${chunkPath}):`,
      streamError?.message || streamError
    );
    return [];
  }

  function isWordInValidSegment(
    word: any,
    validSegments: Array<{ start: number; end: number }>,
    startTime: number
  ) {
    if (!validSegments.length) return true;
    const wStart = word.start + startTime;
    const wEnd = word.end + startTime;
    return validSegments.some(seg => wStart >= seg.start && wEnd <= seg.end);
  }

  try {
    log.debug(
      `[${operationId}] Sending chunk ${chunkIndex} (${(
        fs.statSync(chunkPath).size /
        (1024 * 1024)
      ).toFixed(2)} MB) to Whisper API.`
    );

    const res = await openai.audio.transcriptions.create(
      {
        model: AI_MODELS.WHISPER.id,
        file: fileStream,
        response_format: 'verbose_json',
        temperature: 0,
        prompt: promptContext ?? '',
        timestamp_granularities: ['word', 'segment'],
      },
      { signal }
    );

    log.debug(
      `[${operationId}] Received transcription response for chunk ${chunkIndex}.`
    );

    const segments = (res as any)?.segments as Array<any> | undefined;
    const words = (res as any)?.words as Array<any> | undefined;
    if (!Array.isArray(words) || words.length === 0) {
      log.warn(
        `[${operationId}] Chunk ${chunkIndex}: No word-level timestamps in Whisper response.`
      );
      return [];
    }

    const validSegments: Array<{ start: number; end: number }> = [];
    if (Array.isArray(segments)) {
      for (const seg of segments) {
        if (
          seg.no_speech_prob < NO_SPEECH_PROB_THRESHOLD &&
          seg.avg_logprob > AVG_LOGPROB_THRESHOLD
        ) {
          validSegments.push({
            start: seg.start + startTime,
            end: seg.end + startTime,
          });
        }
      }
    }

    const MAX_SEG_LEN = 8;
    const MAX_WORDS = 12;
    const MIN_WORDS = 3;
    const srtSegments: SrtSegment[] = [];
    let currentWords: any[] = [];
    let groupStart = null;
    let groupEnd = null;
    let segIdx = 1;

    const segmentEnds = new Set<number>();
    if (Array.isArray(segments)) {
      for (const seg of segments) {
        segmentEnds.add(Number((seg.end + startTime).toFixed(3)));
      }
    }

    for (let i = 0; i < words.length; ++i) {
      const w = words[i];
      if (!isWordInValidSegment(w, validSegments, startTime)) continue;
      const wStart = w.start + startTime;
      const wEnd = w.end + startTime;
      if (currentWords.length === 0) {
        groupStart = wStart;
      }
      currentWords.push(w);
      groupEnd = wEnd;
      const isSegmentEnd = segmentEnds.has(Number(wEnd.toFixed(3)));
      const isLastWord = i === words.length - 1;
      const groupDuration = groupEnd - groupStart;
      const groupWordCount = currentWords.length;
      const hardBoundary = isSegmentEnd || isLastWord;
      const sizeBoundary =
        groupDuration >= MAX_SEG_LEN || groupWordCount >= MAX_WORDS;
      const shouldBreak = hardBoundary || sizeBoundary;
      if (shouldBreak) {
        if (groupWordCount < MIN_WORDS && !hardBoundary) {
          continue;
        }
        let text = '';
        for (let j = 0; j < currentWords.length; ++j) {
          const word = currentWords[j].word;
          const isPunctuation = /^[\p{P}$+<=>^`|~]/u.test(word);
          if (j > 0 && !isPunctuation) {
            text += ' ';
          }
          text += word;
        }
        srtSegments.push({
          id: crypto.randomUUID(),
          index: segIdx++,
          start: groupStart,
          end: groupEnd,
          original: text.trim(),
        });
        if (!isLastWord) {
          groupStart = null;
          groupEnd = null;
          currentWords = [];
        }
      }
    }

    const cleanSegs = await scrubHallucinationsBatch({
      segments: srtSegments,
      operationId: operationId ?? '',
      signal,
    });
    return cleanSegs;
  } catch (error: any) {
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

async function scrubHallucinationsBatch({
  segments,
  operationId,
  signal,
}: {
  segments: SrtSegment[];
  operationId: string;
  signal?: AbortSignal;
}): Promise<SrtSegment[]> {
  const videoLen = segments.at(-1)?.end ?? 0;
  const SYSTEM_HEADER = `
VIDEO_LENGTH_SEC = ${Math.round(videoLen)}
An outro is only valid if caption.start_sec > 0.9 * VIDEO_LENGTH_SEC.
*** DO NOT delete ordinary punctuation.  
The following characters are ALWAYS allowed and never count as noise:  
. , ? ! … : ; " ' - – — ( ) [ ] { }
`;
  const systemPrompt = String.raw`
You are a subtitle noise-filter.

${SYSTEM_HEADER}

TASK
────
For every caption decide whether to
  • clean  – remove emoji / ★★★★ / ░░░ / premature "please subscribe", "see you in the next video" etc.
  • delete – if it is only noise (no real words).

OUTPUT  (exactly one line per input, same order)
  @@LINE@@ <index>: <clean text>
If the caption should be deleted output nothing after the colon.

1. Use common sense - if the caption says something like "please subscribe" or "see you in the next video" etc when video is still far from the end, it's probably a hallucination and should be deleted.
2. If the caption is spammy, it's probably a hallucination and should be deleted.
3. Why would a subtitle have any emojis or other non-text characters?

EXAMPLES
────────
input  → 17: ★★★★★★★★★★
output → @@LINE@@ 17:

input  → 18: Thanks for watching!!! 👍👍👍
output → @@LINE@@ 18: Thanks for watching!
`;

  const userPayload = segments
    .map(s => `${s.index} @ ${s.start.toFixed(1)}: ${s.original.trim()}`)
    .join('\n');

  const raw = await callAIModel({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPayload },
    ],
    max_tokens: 4096,
    operationId,
    signal,
  });

  const lineRE = /^@@LINE@@\s+(\d+)\s*:\s*(.*)$/;
  const modelMap = new Map<number, string>();
  raw.split('\n').forEach(row => {
    const m = row.match(lineRE);
    if (m) modelMap.set(Number(m[1]), (m[2] ?? '').trim());
  });

  const stripNoise = (txt: string): string => {
    txt = txt.replace(/\p{Extended_Pictographic}/gu, '');

    txt = txt.replace(/([^\w\s.,'"])\1{2,}/gu, '$1');

    return txt.replace(/\s{2,}/g, ' ').trim();
  };

  const cleanedSegments: SrtSegment[] = [];

  segments.forEach(seg => {
    let out = modelMap.has(seg.index) ? modelMap.get(seg.index)! : seg.original;
    out = stripNoise(out);

    if (out !== '') {
      cleanedSegments.push({ ...seg, original: out });
    }
  });

  return cleanedSegments;
}

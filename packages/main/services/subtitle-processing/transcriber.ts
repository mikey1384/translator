import OpenAI from 'openai';
import log from 'electron-log';
import crypto from 'crypto';
import { AI_MODELS } from '../../../shared/constants/index.js';
import { createFileFromPath } from './openai-client.js';
import { callAIModel } from './openai-client.js';
import { SrtSegment } from '@shared-types/app';
import { NO_SPEECH_PROB_THRESHOLD, LOG_PROB_THRESHOLD } from './constants.js';
import fs from 'fs';

export async function transcribeChunk({
  chunkIndex,
  chunkPath,
  startTime,
  signal,
  openai,
  operationId,
  promptContext,
  language,
  temperature = 0,
  mediaDuration,
}: {
  chunkIndex: number;
  chunkPath: string;
  startTime: number;
  signal?: AbortSignal;
  openai: OpenAI;
  operationId: string;
  promptContext?: string;
  language?: string;
  temperature?: number;
  mediaDuration?: number;
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
        temperature,
        language,
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
          seg.avg_logprob > LOG_PROB_THRESHOLD
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
    let groupStart: number | null = null;
    let groupEnd: number | null = null;
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
      const groupDuration = (groupEnd || 0) - (groupStart || 0);
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
        let avgLogprob = 0;
        let noSpeechProb = 0;
        if (Array.isArray(segments)) {
          const matchingSegment = segments.find(
            seg => Math.abs(seg.end + startTime - (groupEnd || 0)) < 0.1
          );
          if (matchingSegment) {
            avgLogprob = matchingSegment.avg_logprob || 0;
            noSpeechProb = matchingSegment.no_speech_prob || 0;
          }
        }
        srtSegments.push({
          id: crypto.randomUUID(),
          index: segIdx++,
          start: groupStart || 0,
          end: groupEnd || 0,
          original: text.trim(),
          avg_logprob: avgLogprob,
          no_speech_prob: noSpeechProb,
        } as SrtSegment);
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
      mediaDuration,
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
  mediaDuration = 0,
}: {
  segments: SrtSegment[];
  operationId: string;
  signal?: AbortSignal;
  mediaDuration?: number;
}): Promise<SrtSegment[]> {
  const videoLen =
    mediaDuration > 0 ? Math.round(mediaDuration) : (segments.at(-1)?.end ?? 0);
  const SYSTEM_HEADER = `
VIDEO_LENGTH_SEC = ${videoLen}
An outro is only valid if caption.start_sec > 0.9 * VIDEO_LENGTH_SEC.
*** PRESERVING PUNCTUATION IS CRITICAL. DO NOT DELETE OR ALTER STANDARD PUNCTUATION unless it is part of a clear noise pattern (e.g., 'text...???!!!'). ***
The following characters are ALWAYS allowed and never count as noise:  
. , ? ! … : ; " ' - – — ( ) [ ] { }
`;
  const systemPrompt = String.raw`
You are a subtitle noise-filter.

${SYSTEM_HEADER}

TASK
────
For every caption, decide whether to:
  • clean  – Remove only clear noise such as emojis, repeated special characters (e.g., ★★★★, ░░░), or premature promotional phrases like "please subscribe", "see you in the next video" when they appear early in the video (start_sec < 0.9 * VIDEO_LENGTH_SEC).
  • delete – Remove the caption entirely if it contains no meaningful words (e.g., only noise or gibberish).
  • keep as is – If the caption is meaningful and does not contain noise, preserve it exactly, including all standard punctuation.

OUTPUT (exactly one line per input, same order)
  @@LINE@@ <index>: <clean text>
If the caption should be deleted, output nothing after the colon.

RULES (Strictly Follow)
────────────────────
1. **Preserve Standard Punctuation:** Do not remove or alter periods (.), commas (,), question marks (?), exclamation marks (!), or other standard sentence punctuation unless they are part of a noise pattern (e.g., excessive repetition like 'text...???!!!'). If cleaning would require rephrasing that removes punctuation, prioritize keeping the original text unchanged.
2. **Detecting Premature Outros:** If a caption contains phrases like "thanks for watching", "please subscribe", "see you next time", or similar closing remarks AND its start_sec is less than 0.9 * VIDEO_LENGTH_SEC, it is a hallucination and must be deleted.
3. **Spam or Gibberish Detection:** Delete captions that are meaningless, such as random character strings, repeated symbols (e.g., ★★★★★, #####), or nonsensical text with no clear message.
4. **Meaningful but Awkward Text:** If a caption has real words and conveys a message, even if slightly awkward or imperfect, keep it unless it contains clear noise elements to clean.
5. **Timestamp Parsing:** The start time of each caption is provided in the format '<index> @ <start_sec>: <text>'. Use this to evaluate against VIDEO_LENGTH_SEC for outro detection.

EXAMPLES
────────
input  → 17: ★★★★★★★★★★
output → @@LINE@@ 17:

input  → 18: Thanks for watching!!! 👍👍👍 @ 30.5
output → @@LINE@@ 18:

input  → 19: Thanks for watching! See you next time. @ 950.0
output → @@LINE@@ 19: Thanks for watching! See you next time.

input  → 20: Hello, how are you today? @ 50.2
output → @@LINE@@ 20: Hello, how are you today?

input  → 21: This is a test...???!!! @ 100.3
output → @@LINE@@ 21: This is a test.

input  → 22: Subscribe now for more videos! @ 45.7
output → @@LINE@@ 22:

input  → 23: I think this is fine. Don't you? @ 200.1
output → @@LINE@@ 23: I think this is fine. Don't you?

input  → 24: ##### VIDEO END ##### @ 80.4
output → @@LINE@@ 24:
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

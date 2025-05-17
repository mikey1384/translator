import OpenAI from 'openai';
import log from 'electron-log';
import crypto from 'crypto';
import { AI_MODELS } from '../../../shared/constants/index.js';
import { createFileFromPath } from './openai-client.js';
import { SrtSegment } from '@shared-types/app';
import { NO_SPEECH_PROB_THRESHOLD, LOG_PROB_THRESHOLD } from './constants.js';
import fs from 'fs';
import { scrubHallucinationsBatch, throwIfAborted } from './utils.js';

export const VALID_SEG_MARGIN = 0.05;

export async function transcribeChunk({
  chunkIndex,
  chunkPath,
  startTime,
  signal,
  openai,
  operationId,
  promptContext,
  language,
  mediaDuration,
}: {
  chunkIndex: number | string;
  chunkPath: string;
  startTime: number;
  signal?: AbortSignal;
  openai: OpenAI;
  operationId: string;
  promptContext?: string;
  language?: string;
  mediaDuration?: number;
}): Promise<SrtSegment[]> {
  throwIfAborted(signal);

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
        language,
        prompt: `${promptContext ?? ''}\n\n<<<NOSPEECH>>>`,
        timestamp_granularities: ['word', 'segment'],
      },
      { signal }
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
            start: seg.start + startTime - VALID_SEG_MARGIN,
            end: seg.end + startTime + VALID_SEG_MARGIN,
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
      if (groupWordCount < MIN_WORDS && !hardBoundary) continue;
      if (hardBoundary || sizeBoundary) {
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
        const segmentRelativeWords = currentWords.map(cw => {
          const absoluteWordStart = cw.start + startTime;
          const absoluteWordEnd = cw.end + startTime;
          return {
            ...cw,
            start: absoluteWordStart - (groupStart as number),
            end: absoluteWordEnd - (groupStart as number),
          };
        });
        srtSegments.push({
          id: crypto.randomUUID(),
          index: segIdx++,
          start: groupStart || 0,
          end: groupEnd || 0,
          original: text.trim(),
          avg_logprob: avgLogprob,
          no_speech_prob: noSpeechProb,
          words: segmentRelativeWords,
        } as SrtSegment);
        if (!isLastWord) {
          groupStart = null;
          groupEnd = null;
          currentWords = [];
        }
      }
    }

    if (currentWords.length) {
      let text = '';
      for (let j = 0; j < currentWords.length; ++j) {
        const word = currentWords[j].word;
        const isPunctuation = /^[\p{P}$+<=>^`|~]/u.test(word);
        if (j > 0 && !isPunctuation) {
          text += ' ';
        }
        text += word;
      }
      const finalSegmentRelativeWords = currentWords.map(cw => {
        const absoluteWordStart = cw.start + startTime;
        const absoluteWordEnd = cw.end + startTime;
        return {
          ...cw,
          start: absoluteWordStart - (groupStart as number),
          end: absoluteWordEnd - (groupStart as number),
        };
      });
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
        words: finalSegmentRelativeWords,
      } as SrtSegment);
    }

    const cleanSegs = await scrubHallucinationsBatch({
      segments: srtSegments,
      operationId,
      signal,
      mediaDuration,
    });

    const norm = (w: string) => w.replace(/[^{-￿]+$/u, '');
    const lastJSONWord = words.at(-1)?.word?.trim();
    const lastCaptionWord = cleanSegs.at(-1)?.original.split(/\s+/).at(-1);
    if (
      lastJSONWord &&
      lastCaptionWord &&
      norm(lastJSONWord) !== norm(lastCaptionWord)
    ) {
      log.warn(
        `[${operationId}] ⚠️ tail-word mismatch: "${lastJSONWord}" ➜ "${lastCaptionWord}"`
      );
    }
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
  } finally {
    fileStream.destroy();
  }
}

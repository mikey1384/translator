import log from 'electron-log';
import crypto from 'crypto';
import { SrtSegment } from '@shared-types/app';
import { NO_SPEECH_PROB_THRESHOLD, LOG_PROB_THRESHOLD } from './constants.js';
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

    const validSegments: Array<{ start: number; end: number }> = [];
    if (Array.isArray(segments)) {
      for (const seg of segments) {
        if (
          seg.no_speech_prob < NO_SPEECH_PROB_THRESHOLD &&
          seg.avg_logprob > LOG_PROB_THRESHOLD
        ) {
          validSegments.push({
            start: seg.start,
            end: seg.end,
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
          text += ` ${currentWords[j].word}`;
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
          original: text,
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
        text += ` ${currentWords[j].word}`;
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
        original: text,
        avg_logprob: avgLogprob,
        no_speech_prob: noSpeechProb,
        words: finalSegmentRelativeWords,
      } as SrtSegment);
    }

    return srtSegments;
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

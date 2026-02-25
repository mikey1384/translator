import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import log from 'electron-log';
import { scaleProgress, Stage } from './progress.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import { ERROR_CODES } from '../../../../shared/constants/index.js';
import { translateBatch } from '../translator.js';
import { throwIfAborted } from '../utils.js';

export async function translatePass({
  segments,
  targetLang,
  progressCallback,
  operationId,
  qualityTranslation,
  signal,
}: {
  segments: SrtSegment[];
  targetLang: string;
  progressCallback?: GenerateProgressCallback;
  operationId: string;
  qualityTranslation: boolean;
  signal: AbortSignal;
}) {
  // Guard against empty or missing segments
  if (!segments || segments.length === 0) {
    log.warn(`[${operationId}] translatePass called with empty segments`);
    return [];
  }

  if (targetLang === 'original') {
    // Explicitly mark translation as skipped to keep UI progress accurate
    try {
      progressCallback?.({
        percent: scaleProgress(100, Stage.START, Stage.TRANSLATE),
        stage: 'Skipping translation (same language)',
        partialResult: buildSrt({ segments, mode: 'dual' }),
      });
    } catch {
      // ignore progress errors
    }
    return segments;
  }

  const segmentsInProcess = segments.map((seg, i) => ({
    ...seg,
    index: i + 1,
  }));
  const totalSegments = segmentsInProcess.length;
  const TRANSLATION_BATCH_SIZE = 10;
  // Provide local textual context around each batch for correctness
  const CONTEXT_BEFORE = 12;
  const CONTEXT_AFTER = 12;

  // Correctness-first: process batches sequentially (no concurrency)
  let aborted = false;
  let batchesDone = 0;

  for (
    let batchStart = 0;
    batchStart < totalSegments;
    batchStart += TRANSLATION_BATCH_SIZE
  ) {
    throwIfAborted(signal);

    const batchEnd = Math.min(
      batchStart + TRANSLATION_BATCH_SIZE,
      totalSegments
    );
    const currentBatchOriginals = segmentsInProcess.slice(batchStart, batchEnd);
    const contextBefore: SrtSegment[] = segmentsInProcess.slice(
      Math.max(0, batchStart - CONTEXT_BEFORE),
      batchStart
    );
    const contextAfter: SrtSegment[] = segmentsInProcess.slice(
      batchEnd,
      Math.min(totalSegments, batchEnd + CONTEXT_AFTER)
    );

    try {
      const translatedBatch = await translateBatch({
        batch: {
          segments: currentBatchOriginals.map(seg => ({ ...seg })),
          startIndex: batchStart,
          endIndex: batchEnd,
          contextBefore,
          contextAfter,
        },
        targetLang,
        qualityMode: qualityTranslation,
        operationId,
        signal,
      });

      if (signal?.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      for (let i = 0; i < translatedBatch.length; i++) {
        segmentsInProcess[batchStart + i] = translatedBatch[i];
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) {
        aborted = true;
        log.info(`[${operationId}] translate batch cancelled`);
        throw err;
      }
      const msg = String(err?.message || err || '');
      if (msg.includes(ERROR_CODES.INSUFFICIENT_CREDITS)) {
        aborted = true;
        log.info(`[${operationId}] translate batch aborted (credits)`);
        throw err;
      }
      // Handle API key and rate limit errors for both OpenAI and Anthropic
      if (
        msg === ERROR_CODES.OPENAI_KEY_INVALID ||
        msg === ERROR_CODES.OPENAI_RATE_LIMIT ||
        msg === ERROR_CODES.ANTHROPIC_KEY_INVALID ||
        msg === ERROR_CODES.ANTHROPIC_RATE_LIMIT
      ) {
        aborted = true;
        log.info(`[${operationId}] translate batch aborted (${msg})`);
        throw err;
      }
      log.error(`[${operationId}] translate batch failed`, err);
      throw err;
    }

    // Progress after each sequential batch
    if (!signal?.aborted && !aborted) {
      batchesDone++;
      const doneSoFar = Math.min(
        batchesDone * TRANSLATION_BATCH_SIZE,
        totalSegments
      );
      progressCallback?.({
        percent: scaleProgress(
          (doneSoFar / totalSegments) * 100,
          Stage.START,
          qualityTranslation ? Stage.TRANSLATE : Stage.END
        ),
        stage: `Translating ${doneSoFar}/${totalSegments}`,
        partialResult: buildSrt({
          segments: segmentsInProcess,
          mode: 'dual',
        }),
        current: doneSoFar,
        total: totalSegments,
      });
    }
  }

  if (aborted || signal?.aborted) {
    const e = new DOMException('Operation cancelled', 'AbortError');
    log.info(`[${operationId}] Translation cancelled during batch processing`);
    throw e;
  }

  throwIfAborted(signal);

  return segmentsInProcess;
}

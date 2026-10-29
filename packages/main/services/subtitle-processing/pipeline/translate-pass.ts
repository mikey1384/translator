import { attachPartialTranslation } from '../translation-coverage.js';
import { planTranslationWindows } from '../translation-batches.js';
import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import log from 'electron-log';
import { scaleProgress, Stage } from './progress.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import { ERROR_CODES } from '../../../../shared/constants/index.js';
import { translateBatch } from '../translator.js';
import { runWithConcurrencySerialFallback, throwIfAborted } from '../utils.js';
import {
  isTranslationAdmissionLimitError,
  isProviderRateLimitError,
  shouldRetrySerialBatch,
} from '../errors.js';
import {
  TRANSLATION_CONCURRENCY,
  ADMISSION_RETRY_DELAY_MS,
  ADMISSION_RETRY_MAX_ATTEMPTS,
  ADMISSION_RETRY_MAX_TOTAL_MS,
} from '../constants.js';

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
        phaseKey: 'translate',
        partialResult: buildSrt({ segments, mode: 'dual' }),
        partialSegments: segments,
        current: segments.length,
        total: segments.length,
        unit: 'segments',
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

  // Batches are independent (context sends source text only), so run a few
  // concurrently. Progress counts completed segments, which stays monotonic
  // even when batches finish out of order.
  const windows = planTranslationWindows(segmentsInProcess, 'draft');
  log.info(
    `[${operationId}] translation plan: phase=draft cues=${totalSegments} requests=${windows.length} maxConcurrent=${TRANSLATION_CONCURRENCY}`
  );
  let translatedSoFar = 0;

  await runWithConcurrencySerialFallback({
    taskCount: windows.length,
    concurrency: TRANSLATION_CONCURRENCY,
    // Concurrent batches transiently reserve N× credits, can trip the
    // server's per-device admission cap, and on BYO accounts can exceed the
    // provider's own request-rate tier; retry serially so a balance, slot,
    // or rate budget that funds one call at a time still completes.
    isDeferrable: err =>
      !(err as any)?.partialSegments?.some((s: SrtSegment) =>
        s.translation?.trim()
      ) &&
      (String((err as any)?.message || err || '').includes(
        ERROR_CODES.INSUFFICIENT_CREDITS
      ) ||
        isTranslationAdmissionLimitError(err) ||
        isProviderRateLimitError(err)) &&
      !signal?.aborted,
    // Admission 429s and provider rate limits clear with time. A 402 in the
    // serial phase is final: retrying it only keeps the user waiting before
    // the credits dialog.
    serialRetry: {
      shouldRetry: err => shouldRetrySerialBatch(err, signal),
      delayMs: ADMISSION_RETRY_DELAY_MS,
      // Honor a server-advertised Retry-After when present.
      delayMsFor: err => {
        const retryAfterSec = (err as any)?.retryAfterSec;
        return typeof retryAfterSec === 'number' && retryAfterSec > 0
          ? retryAfterSec * 1000
          : undefined;
      },
      maxAttempts: ADMISSION_RETRY_MAX_ATTEMPTS,
      maxTotalDelayMs: ADMISSION_RETRY_MAX_TOTAL_MS,
      signal,
    },
    onFallback: count =>
      log.info(
        `[${operationId}] concurrency backpressure (credits/admission); retrying ${count} translate batches sequentially`
      ),
    runTask: async taskIndex => {
      throwIfAborted(signal);

      const {
        start: batchStart,
        end: batchEnd,
        contextStart,
        contextEnd,
      } = windows[taskIndex];
      const currentBatchOriginals = segmentsInProcess.slice(
        batchStart,
        batchEnd
      );
      const contextBefore: SrtSegment[] = segmentsInProcess.slice(
        contextStart,
        batchStart
      );
      const contextAfter: SrtSegment[] = segmentsInProcess.slice(
        batchEnd,
        contextEnd
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

        for (let i = 0; i < translatedBatch.length; i++) {
          segmentsInProcess[batchStart + i] = translatedBatch[i];
        }
        if (signal?.aborted) {
          throw new DOMException('Operation cancelled', 'AbortError');
        }
      } catch (err: any) {
        if (
          Array.isArray(err?.partialSegments) &&
          err.partialSegments.length === currentBatchOriginals.length
        ) {
          for (let i = 0; i < err.partialSegments.length; i++)
            segmentsInProcess[batchStart + i] = {
              ...err.partialSegments[i],
              translation: err.partialSegments[i].translation?.trim()
                ? err.partialSegments[i].translation
                : segmentsInProcess[batchStart + i].translation,
            };
        }
        if (err?.name === 'AbortError' || signal?.aborted) {
          log.info(`[${operationId}] translate batch cancelled`);
          throw err;
        }
        const msg = String(err?.message || err || '');
        if (msg.includes(ERROR_CODES.INSUFFICIENT_CREDITS)) {
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
          log.info(`[${operationId}] translate batch aborted (${msg})`);
          throw err;
        }
        log.error(`[${operationId}] translate batch failed`, err);
        throw err;
      }

      if (!signal?.aborted) {
        translatedSoFar += batchEnd - batchStart;
        progressCallback?.({
          percent: scaleProgress(
            (translatedSoFar / totalSegments) * 100,
            Stage.START,
            qualityTranslation ? Stage.TRANSLATE : Stage.END
          ),
          stage: `Translating ${translatedSoFar}/${totalSegments}`,
          phaseKey: 'translate',
          partialResult: buildSrt({
            segments: segmentsInProcess,
            mode: 'dual',
          }),
          partialSegments: segmentsInProcess.map(s => ({ ...s })),
          current: translatedSoFar,
          total: totalSegments,
          unit: 'segments',
        });
      }
    },
  }).catch(error => {
    attachPartialTranslation(error, segmentsInProcess);
    throw error;
  });

  if (signal?.aborted) {
    const e = new DOMException('Operation cancelled', 'AbortError');
    log.info(`[${operationId}] Translation cancelled during batch processing`);
    throw e;
  }

  throwIfAborted(signal);

  return segmentsInProcess;
}

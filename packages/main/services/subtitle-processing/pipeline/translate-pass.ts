import { attachPartialTranslation } from '../translation-coverage.js';
import { withTranslationReview } from '../../../../shared/helpers/translation-review.js';
import {
  creditRecoveryWindow,
  planTranslationWindows,
  type TranslationWindow,
} from '../translation-batches.js';
import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import log from 'electron-log';
import { scaleProgress, Stage } from './progress.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import { ERROR_CODES } from '../../../../shared/constants/index.js';
import { translateBatch } from '../translator.js';
import { getActiveProvider } from '../../ai-provider.js';
import { runWithConcurrencySerialFallback, throwIfAborted } from '../utils.js';
import {
  isInsufficientCreditsError,
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
  const completed = new Set<number>();
  const emitProgress = () => {
    if (signal.aborted) return;
    progressCallback?.({
      percent: scaleProgress(
        (completed.size / totalSegments) * 100,
        Stage.START,
        qualityTranslation ? Stage.TRANSLATE : Stage.END
      ),
      stage: `Translating ${completed.size}/${totalSegments}`,
      phaseKey: 'translate',
      partialResult: buildSrt({ segments: segmentsInProcess, mode: 'dual' }),
      partialSegments: segmentsInProcess.map(s => ({ ...s })),
      current: completed.size,
      total: totalSegments,
      unit: 'segments',
    });
  };
  const applyRange = (start: number, translated: SrtSegment[]) => {
    for (let i = 0; i < translated.length; i++) {
      if (!translated[i].translation?.trim()) continue;
      const draft = {
        ...translated[i],
        translationReview: undefined,
      };
      segmentsInProcess[start + i] = qualityTranslation
        ? withTranslationReview(draft, targetLang, 'pending')
        : draft;
      completed.add(start + i);
    }
    emitProgress();
  };

  const translateWindow = async (
    window: TranslationWindow,
    allowCreditSplit: boolean
  ): Promise<void> => {
    throwIfAborted(signal);
    const { start, end, contextStart, contextEnd } = window;
    // Admission/rate retries re-enter the original task. Its earlier split
    // children may already be paid and complete, so resume only missing runs.
    if (
      Array.from({ length: end - start }, (_, i) => start + i).some(i =>
        completed.has(i)
      )
    ) {
      for (let next = start; next < end; ) {
        if (completed.has(next)) {
          next++;
          continue;
        }
        let missingEnd = next + 1;
        while (missingEnd < end && !completed.has(missingEnd)) missingEnd++;
        await translateWindow(
          creditRecoveryWindow(segmentsInProcess, next, missingEnd),
          allowCreditSplit
        );
        next = missingEnd;
      }
      return;
    }
    try {
      const translated = await translateBatch({
        batch: {
          segments: segmentsInProcess
            .slice(start, end)
            .map(seg => ({ ...seg })),
          startIndex: start,
          endIndex: end,
          contextBefore: segmentsInProcess.slice(contextStart, start),
          contextAfter: segmentsInProcess.slice(end, contextEnd),
        },
        targetLang,
        qualityMode: qualityTranslation,
        operationId,
        signal,
      });
      applyRange(start, translated);
      throwIfAborted(signal);
    } catch (error: any) {
      const partial =
        Array.isArray(error?.partialSegments) &&
        error.partialSegments.length === end - start
          ? (error.partialSegments as SrtSegment[])
          : undefined;
      const hasPaidPartial = partial?.some(segment =>
        segment.translation?.trim()
      );
      if (partial) applyRange(start, partial);
      if (signal.aborted || error?.name === 'AbortError') throw error;
      // A repair may fail after a paid draft completed. Preserve that work;
      // never split/re-key an uncertain or partially paid parent request.
      if (
        !allowCreditSplit ||
        hasPaidPartial ||
        !isInsufficientCreditsError(error) ||
        getActiveProvider() !== 'stage5'
      )
        throw error;

      if (end - start > 1) {
        const middle = start + Math.floor((end - start) / 2);
        log.info(
          `[${operationId}] Credit refusal: splitting draft cues ${start + 1}-${end}`
        );
        await translateWindow(
          creditRecoveryWindow(segmentsInProcess, start, middle),
          true
        );
        await translateWindow(
          creditRecoveryWindow(segmentsInProcess, middle, end),
          true
        );
        return;
      }
      // A single cue can still carry a large original context window. Try
      // once with bounded context, then stop; never divide its text.
      const smaller = creditRecoveryWindow(segmentsInProcess, start, end);
      if (
        smaller.contextStart > contextStart ||
        smaller.contextEnd < contextEnd
      ) {
        await translateWindow(smaller, true);
        return;
      }
      throw error;
    }
  };

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
    // Admission and rate limits can clear with time. Credit recovery shrinks
    // only confirmed refused work inside the serial task below.
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
    runTask: (taskIndex, phase) =>
      translateWindow(windows[taskIndex], phase === 'serial'),
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

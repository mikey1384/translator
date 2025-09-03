import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import pLimit from 'p-limit';
import log from 'electron-log';
import { scaleProgress, Stage } from './progress.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import { translateBatch } from '../translator.js';
import { throwIfAborted } from '../utils.js';
import { MAX_AI_PARALLEL } from '../../../../shared/constants/runtime-config.js';

export async function translatePass({
  segments,
  targetLang,
  progressCallback,
  operationId,
  signal,
}: {
  segments: SrtSegment[];
  targetLang: string;
  progressCallback?: GenerateProgressCallback;
  operationId: string;
  signal: AbortSignal;
}) {
  if (targetLang === 'original') {
    // Explicitly mark translation as skipped to keep UI progress accurate
    try {
      progressCallback?.({
        percent: scaleProgress(100, Stage.TRANSLATE, Stage.REVIEW),
        stage: 'Skipping translation (same language)',
        partialResult: buildSrt({ segments, mode: 'dual' }),
      });
    } catch {
      // ignore progress errors
    }
    return segments;
  }

  // Preserve incoming segmentation exactly as produced by transcription/gap-repair
  const segmentsInProcess = segments.map((seg, i) => ({
    ...seg,
    index: i + 1,
  }));
  const totalSegments = segmentsInProcess.length;
  const TRANSLATION_BATCH_SIZE = 10;
  // Provide local textual context around each batch for correctness
  const CONTEXT_BEFORE = 12;
  const CONTEXT_AFTER = 12;

  const CONCURRENT_TRANSLATIONS = Math.min(4, MAX_AI_PARALLEL);
  const limit = pLimit(CONCURRENT_TRANSLATIONS);

  const batchPromises = [] as Promise<void>[];
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

    const promise = limit(() =>
      translateBatch({
        batch: {
          segments: currentBatchOriginals.map(seg => ({ ...seg })),
          startIndex: batchStart,
          endIndex: batchEnd,
          contextBefore,
          contextAfter,
        },
        targetLang,
        operationId,
        signal,
      }).then(translatedBatch => {
        if (signal?.aborted) {
          throw new DOMException('Operation cancelled', 'AbortError');
        }

        for (let i = 0; i < translatedBatch.length; i++) {
          segmentsInProcess[batchStart + i] = translatedBatch[i];
        }
      })
    )
      .catch(err => {
        if (err?.name === 'AbortError' || signal?.aborted) {
          aborted = true;
          log.info(`[${operationId}] translate batch cancelled`);
        } else {
          const msg = String(err?.message || err || '');
          if (/insufficient-credits/i.test(msg)) {
            aborted = true;
            log.info(`[${operationId}] translate batch aborted (credits)`);
          } else {
            log.error(`[${operationId}] translate batch failed`, err);
          }
        }
        throw err;
      })
      .finally(() => {
        if (aborted || signal?.aborted) return; // suppress progress updates after abort
        batchesDone++;
        const doneSoFar = Math.min(
          batchesDone * TRANSLATION_BATCH_SIZE,
          totalSegments
        );

        if (!signal?.aborted && !aborted) {
          progressCallback?.({
            percent: scaleProgress(
              (doneSoFar / totalSegments) * 100,
              Stage.TRANSLATE,
              Stage.REVIEW
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
      });

    batchPromises.push(promise);
  }

  try {
    await Promise.all(batchPromises);
  } catch (error: any) {
    if (error.name === 'AbortError' || signal?.aborted) {
      log.info(
        `[${operationId}] Translation cancelled during batch processing`
      );
      throw error;
    }
    throw error;
  }

  throwIfAborted(signal);

  // Skip AI review/cleanup; return raw translated segments as-is.
  return segmentsInProcess;
}

import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import pLimit from 'p-limit';
import log from 'electron-log';
import { scaleProgress, Stage } from './progress.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import { translateBatch, reviewTranslationBatch } from '../translator.js';
import {
  REVIEW_OVERLAP_CTX,
  REVIEW_BATCH_SIZE,
  REVIEW_STEP,
} from '../constants.js';
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

  const CONCURRENT_TRANSLATIONS = Math.min(4, MAX_AI_PARALLEL);
  const limit = pLimit(CONCURRENT_TRANSLATIONS);

  const batchPromises = [];

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
    const contextBefore = segmentsInProcess.slice(
      Math.max(0, batchStart - REVIEW_OVERLAP_CTX),
      batchStart
    );
    const contextAfter = segmentsInProcess.slice(
      batchEnd,
      Math.min(batchEnd + REVIEW_OVERLAP_CTX, segmentsInProcess.length)
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
        if (err.name !== 'AbortError' && !signal?.aborted) {
          log.error(`[${operationId}] translate batch failed`, err);
        } else {
          log.info(`[${operationId}] translate batch cancelled`);
        }
        throw err;
      })
      .finally(() => {
        batchesDone++;
        const doneSoFar = Math.min(
          batchesDone * TRANSLATION_BATCH_SIZE,
          totalSegments
        );

        if (!signal?.aborted) {
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

  const totalToClean = segmentsInProcess.length;
  progressCallback?.({
    percent: scaleProgress(0, Stage.REVIEW, Stage.FINAL),
    stage: `__i18n__:translation_cleanup:0:${totalToClean}`,
  });

  for (
    let batchStart = 0;
    batchStart < segmentsInProcess.length;
    batchStart += REVIEW_STEP
  ) {
    const batchEnd = Math.min(
      batchStart + REVIEW_BATCH_SIZE,
      segmentsInProcess.length
    );

    const overall = (batchStart / segmentsInProcess.length) * 100;
    // Accurate batch counters accounting for overlap and step
    const reviewBatchIndex = Math.floor(batchStart / REVIEW_STEP) + 1;
    const reviewTotalBatches =
      Math.ceil(
        Math.max(0, segmentsInProcess.length - REVIEW_BATCH_SIZE) /
          Math.max(1, REVIEW_STEP)
      ) + 1;
    progressCallback?.({
      percent: scaleProgress(overall, Stage.REVIEW, Stage.FINAL),
      stage: `Reviewing batch ${reviewBatchIndex} of ${reviewTotalBatches}`,
      partialResult: buildSrt({
        segments: segmentsInProcess,
        mode: 'dual',
      }),
      current: batchStart,
      total: segmentsInProcess.length,
      batchStartIndex: batchStart,
    });

    const reviewSlice = segmentsInProcess.slice(batchStart, batchEnd);
    const contextBefore = segmentsInProcess.slice(
      Math.max(0, batchStart - REVIEW_OVERLAP_CTX),
      batchStart
    );
    const contextAfter = segmentsInProcess.slice(
      batchEnd,
      Math.min(batchEnd + REVIEW_OVERLAP_CTX, segmentsInProcess.length)
    );

    const reviewed = await reviewTranslationBatch({
      batch: {
        segments: reviewSlice,
        startIndex: batchStart,
        endIndex: batchEnd,
        targetLang,
        contextBefore,
        contextAfter,
      },
      operationId,
      signal,
    });

    for (let i = 0; i < reviewed.length; i++) {
      const globalIdx = batchStart + i;
      if (
        !segmentsInProcess[globalIdx].reviewedInBatch ||
        segmentsInProcess[globalIdx].reviewedInBatch < batchStart
      ) {
        segmentsInProcess[globalIdx] = {
          ...reviewed[i],
          reviewedInBatch: batchStart,
        };
      }
    }
  }

  return segmentsInProcess;
}

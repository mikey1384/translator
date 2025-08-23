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
  MAX_GAP_TO_FUSE,
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
    return segments;
  }

  const segmentsInProcess = fuseOrphans(segments).map((seg, i) => ({
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

function fuseOrphans(segments: SrtSegment[]): SrtSegment[] {
  const MIN_WORDS = 4;
  const MAX_DURATION_SEC = 7.0;
  const MIN_DURATION_SEC = 1.0;
  const MAX_CHARS_PER_LINE = 42;
  const MAX_TOTAL_CHARS = 84; // proxy for two lines
  const MAX_CPS = 17; // characters per second

  if (!segments.length) return [];

  const fused: SrtSegment[] = [];

  const safeJoin = (a: string, b: string) => {
    const left = a.trim();
    const right = b.trim();
    if (!left) return right;
    if (!right) return left;
    const needsSpace =
      /[\p{L}\p{N}]$/u.test(left) && /^[\p{L}\p{N}]/u.test(right);
    return needsSpace ? `${left} ${right}` : `${left}${right}`;
  };

  const computeCps = (text: string, start: number, end: number) => {
    const duration = Math.max(0.001, end - start);
    const chars = text.replace(/\n/g, '').length;
    return chars / duration;
  };

  for (const seg of segments) {
    const wordCount = seg.original.trim().split(/\s+/).filter(Boolean).length;

    if (wordCount < MIN_WORDS && fused.length) {
      const prev = fused[fused.length - 1];
      const gap = seg.start - prev.end;

      if (gap < MAX_GAP_TO_FUSE) {
        const newStart = prev.start;
        const newEnd = seg.end;
        const joinedText = safeJoin(prev.original, seg.original);

        const durationOk =
          newEnd - newStart <= MAX_DURATION_SEC &&
          newEnd - newStart >= MIN_DURATION_SEC;
        const lengthOk = joinedText.length <= MAX_TOTAL_CHARS;
        const cpsOk = computeCps(joinedText, newStart, newEnd) <= MAX_CPS;

        if (durationOk && lengthOk && cpsOk) {
          prev.end = newEnd;
          prev.original = joinedText;
          continue;
        }
      }
    }

    fused.push({ ...seg });
  }

  // Final sanity: ensure cues are not excessively long by trimming whitespace
  for (const s of fused) {
    s.original = s.original.trim();
    const duration = Math.max(0.001, s.end - s.start);
    const cps = s.original.length / duration;
    if (cps > 1.5 * 17 || s.original.length > 2 * MAX_CHARS_PER_LINE) {
      s.original = s.original.replace(/\s+/g, ' ').trim();
    }
  }

  return fused.map((s, i) => ({ ...s, index: i + 1 }));
}

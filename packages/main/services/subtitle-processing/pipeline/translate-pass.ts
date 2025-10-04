import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import log from 'electron-log';
import { scaleProgress, Stage } from './progress.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import { translateBatch } from '../translator.js';
import { computeTranslationWordTimings } from '../word-timings.js';
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
        operationId,
        signal,
      });

      if (signal?.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      for (let i = 0; i < translatedBatch.length; i++) {
        const upd = translatedBatch[i];
        const idx = batchStart + i;
        const base = segmentsInProcess[idx];
        const translation = (upd.translation ?? '').trim();
        const origWords = (base.origWords ?? base.words ?? []) as any[];
        let transWords: Array<{ start: number; end: number; word: string }> | undefined = undefined;
        if (translation && Array.isArray(origWords) && origWords.length > 0) {
          const segStart = Number(base.start) || 0;
          const segDuration = Math.max(0, (base.end || 0) - (base.start || 0));
          const segEnd = segStart + segDuration;
          const numericWords = origWords
            .map(w => ({
              start: Number(w.start),
              end: Number(w.end),
            }))
            .filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
          const tol = 0.5;
          let absHits = 0;
          let relHits = 0;
          for (const w of numericWords) {
            const s = w.start;
            const e = w.end;
            if (s >= segStart - tol && e <= segEnd + tol) absHits++;
            if (s >= -tol && e <= segDuration + tol) relHits++;
          }
          const treatAsAbsolute = absHits > relHits && absHits > 0;
          transWords = computeTranslationWordTimings({
            originalWords: numericWords.map(w => ({
              start: Math.max(0, treatAsAbsolute ? w.start - segStart : w.start),
              end: Math.max(0, treatAsAbsolute ? w.end - segStart : w.end),
            })),
            translatedText: translation,
            segmentDuration: segDuration,
            langHint: undefined,
          });
        }
        segmentsInProcess[idx] = {
          ...base,
          ...upd,
          transWords,
        } as any;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) {
        aborted = true;
        log.info(`[${operationId}] translate batch cancelled`);
        throw err;
      }
      const msg = String(err?.message || err || '');
      if (/insufficient-credits/i.test(msg)) {
        aborted = true;
        log.info(`[${operationId}] translate batch aborted (credits)`);
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

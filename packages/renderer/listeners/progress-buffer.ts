import { parseSrt } from '../../shared/helpers';
import * as SubtitlesIPC from '@ipc/subtitles';
import { useTaskStore } from '../state/task-store';
import { useSubStore } from '../state/subtitle-store';
import { useUIStore } from '../state/ui-store';
import { useCreditStore } from '../state/credit-store';
import { useAiStore } from '../state/ai-store';
import { i18n } from '../i18n';
import { logTask, logPhase } from '../utils/logger';
import { openCreditRanOut } from '../state/modal-store';

type ProgressPayload = Parameters<
  Parameters<typeof SubtitlesIPC.onGenerateProgress>[0]
>[1];

let queued: ProgressPayload | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let isFlushing = false;
let lastParsed = 0;
let lastTranscribe = { id: null as string | null, stage: '' };
let lastTranslate = { id: null as string | null, stage: '' };
let lastCreditsRefreshTs = 0;
// Track how many tail-segments have been appended per operation
const tailCounts: Record<string, number> = Object.create(null);

function flush() {
  if (isFlushing) return;
  isFlushing = true;
  try {
    if (!queued) return;

    const {
      stage = '',
      percent = 0,
      operationId,
      batchStartIndex,
      partialResult,
      error,
    } = queued as any;
    const stageLower = (stage ?? '').toLowerCase();

    // If we detect credits exhaustion, trigger the global modal once
    if (typeof error === 'string' && /insufficient-credits/i.test(error)) {
      try {
        const s = useAiStore.getState();
        const usingApiKey = Boolean(
          s.useByo && s.byoUnlocked && (s.keyPresent || (s.keyValue || '').trim())
        );
        if (!usingApiKey) openCreditRanOut();
      } catch {
        // Do nothing
      }
    }

    // Route updates based on operationId prefix
    const isTranscribe = operationId?.startsWith('transcribe-');
    const isTranslate = operationId?.startsWith('translate-');
    const looksLikeReview = /\breviewing\b/i.test(stage ?? '');
    const isTranslateMissing = operationId?.startsWith('translate-missing-');

    // Apply translation deltas as early as possible to avoid being
    // short-circuited by completion guards or racey progress ordering.
    if (partialResult?.trim()) {
      const isTranslateRelated =
        isTranslate || isTranslateMissing || looksLikeReview;
      if (isTranslateRelated) {
        if (percent >= 100 || Date.now() - lastParsed > 1000) {
          try {
            const partSegs = parseSrt(partialResult);
            if (partSegs.length) {
              useSubStore.getState().applyTranslations(partSegs);
            }
          } catch {
            // Ignore parse/apply errors for partial updates
          }
          lastParsed = Date.now();
        }
      }
    }

    // After completion, stop applying any further queued updates
    const isComplete =
      percent >= 100 || /processing complete/i.test(stage ?? '');

    // Tail continuation: when startOffset is provided, partialResult SRT is
    // relative to the tail slice; append new cues incrementally with offset.
    if (isTranscribe) {
      const startOffset = (queued as any)?.startOffset;
      if (typeof startOffset === 'number' && isFinite(startOffset)) {
        const srt = (queued as any)?.partialResult as string | undefined;
        if (srt && (isComplete || Date.now() - lastParsed > 1500)) {
          try {
            const partSegs = parseSrt(srt);
            if (partSegs.length) {
              // Track per-operation how many tail segments we've already appended
              tailCounts[operationId!] = tailCounts[operationId!] ?? 0;
              const already = tailCounts[operationId!];
              // Offset times to absolute timeline
              const adjusted = partSegs.map(s => ({
                start: (s.start || 0) + startOffset,
                end: (s.end || 0) + startOffset,
                original: String(s.original || ''),
              }));
              if (adjusted.length > already) {
                const news = adjusted.slice(already);
                useSubStore.getState().appendSegments(news);
                tailCounts[operationId!] = adjusted.length;
              }
            }
          } catch {
            // ignore parse errors
          }
          lastParsed = Date.now();
        }
      }
    }

    if (isTranslate) {
      const active = useTaskStore.getState().translation.id;
      const inProgress = useTaskStore.getState().translation.inProgress;
      if (active && operationId && operationId !== active) {
        queued = null;
        return;
      }
      // Log start of translation task when operation changes
      if (operationId && lastTranslate.id !== operationId) {
        try {
          logTask('start', 'translation', { operationId });
        } catch {
          // Do nothing
        }
        lastTranslate = { id: operationId, stage: '' };
      }
      useTaskStore.getState().setTranslation({
        stage,
        percent,
        id: operationId ?? null,
        batchStartIndex,
      });
      // Log phase changes (stage string transitions)
      if (stage && operationId && lastTranslate.stage !== stage) {
        try {
          logPhase(
            'translation',
            translateBackendStage(stage, i18n.t.bind(i18n)),
            percent,
            { operationId }
          );
        } catch {
          // Do nothing
        }
        lastTranslate.stage = stage;
      }
      if (isComplete) {
        queued = null;
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        try {
          if (operationId) logTask('complete', 'translation', { operationId });
        } catch {
          // Do nothing
        }
        return;
      }
      // If the task has been marked complete (inProgress=false), ignore any late non-final updates
      if (!inProgress) {
        queued = null;
        return;
      }
    } else if (isTranscribe) {
      const active = useTaskStore.getState().transcription.id;
      if (active && operationId && operationId !== active) {
        queued = null;
        return;
      }
      // Log start of transcription task when operation changes
      if (operationId && lastTranscribe.id !== operationId) {
        try {
          logTask('start', 'transcription', { operationId });
        } catch {
          // Do nothing
        }
        lastTranscribe = { id: operationId, stage: '' };
      }
      useTaskStore.getState().setTranscription({
        stage,
        percent,
        id: operationId ?? null,
        batchStartIndex,
      });
      // Log phase changes (stage string transitions)
      if (stage && operationId && lastTranscribe.stage !== stage) {
        try {
          logPhase(
            'transcription',
            translateBackendStage(stage, i18n.t.bind(i18n)),
            percent,
            { operationId }
          );
        } catch {
          // Do nothing
        }
        lastTranscribe.stage = stage;
      }

      // Surface progress to the user by opening the Edit panel automatically
      // when transcription is underway so the incremental results are visible.
      try {
        const { showEditPanel, setEditPanelOpen } = useUIStore.getState();
        if (!showEditPanel) setEditPanelOpen(true);
      } catch {
        // Do nothing
      }
    }

    // Apply partial SRT updates during processing.
    // - Translation flows: patch translations in-place
    // - Full transcription (non-tail): append via applyTranscriptionProgress
    if (partialResult?.trim()) {
      if (isTranscribe) {
        const startOffset = (queued as any)?.startOffset;
        if (!(typeof startOffset === 'number' && isFinite(startOffset))) {
          // Full transcription stream (not tail)
          if (isComplete || Date.now() - lastParsed > 1500) {
            try {
              const partSegs = parseSrt(partialResult);
              if (partSegs.length) {
                useSubStore.getState().applyTranscriptionProgress(partSegs);
              }
            } catch {
              // ignore parse errors
            }
            lastParsed = Date.now();
          }
        }
      } else if (isComplete || Date.now() - lastParsed > 1500) {
        // Translation: reload occasionally
        try {
          // Preserve origin/sourceVideoPath during translation progress updates
          const prev = useSubStore.getState();
          useSubStore
            .getState()
            .load(
              parseSrt(partialResult),
              undefined,
              prev.origin ?? null,
              prev.sourceVideoPath ?? null
            );
        } catch {
          // Do nothing
        }
        lastParsed = Date.now();
      }
    }

    // After completion, stop applying any further queued updates
    if (isComplete) {
      // Explicitly clear active transcription id so future operations aren't dropped
      if (isTranscribe) {
        try {
          useTaskStore.getState().setTranscription({ inProgress: false });
        } catch {
          // Do nothing
        }

        try {
          useSubStore.getState().bridgeGaps(3);
        } catch {
          // Do nothing
        }
        // Generate Gap/LC caches once per transcription process
        try {
          useSubStore.getState().recomputeCaches(3);
        } catch {
          // Do nothing
        }
      } else {
        // Translation completed: recompute caches to repopulate Gap/LC lists
        try {
          useSubStore.getState().recomputeCaches(3);
        } catch {
          // Do nothing
        }
      }
      // If process was cancelled (e.g., due to credit exhaustion), refresh credit state
      if (/cancel/.test(stageLower)) {
        try {
          useCreditStore.getState().refresh();
        } catch {
          // Do nothing
        }
      }
      // Clear tail counters for completed operations
      if (isTranscribe && operationId) {
        delete tailCounts[operationId];
      }
      queued = null;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      return;
    }

    // Refresh credit balance during AI processing phases when credits are being consumed
    // stageLower declared earlier
    const isActiveAIPhase =
      stageLower.includes('transcrib') ||
      stageLower.includes('translat') ||
      stageLower.includes('reviewing') ||
      stageLower.includes('__i18n__:transcribed');

    if (isActiveAIPhase && percent > 0 && percent <= 100) {
      const now = Date.now();
      if (now - lastCreditsRefreshTs > 5000) {
        try {
          useCreditStore.getState().refresh();
        } catch {
          // Do nothing
        }
        lastCreditsRefreshTs = now;
      }
    }

    queued = null;
  } finally {
    isFlushing = false;
  }
}

SubtitlesIPC.onGenerateProgress(progress => {
  queued = progress;

  if (!document.hidden) {
    flush();
    return;
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, 500);
  }
});

SubtitlesIPC.onDubProgress((eventOrProgress, progressMaybe) => {
  try {
    const progress = progressMaybe ?? eventOrProgress ?? {};
    const stage = progress?.stage ?? '';
    const percent =
      typeof progress?.percent === 'number' ? progress.percent : 0;
    const operationId =
      typeof progress?.operationId === 'string' ? progress.operationId : null;
    const error = (progress as any)?.error as string | undefined;

    if (typeof error === 'string' && /insufficient-credits/i.test(error)) {
      try {
        openCreditRanOut();
      } catch {
        // Do nothing
      }
    }

    useTaskStore.getState().setDubbing({
      stage,
      percent,
      id: operationId,
    });

    const lower = stage.toLowerCase();
    if (
      percent >= 100 ||
      /complete|done/.test(lower) ||
      /cancel/.test(lower) ||
      typeof error === 'string'
    ) {
      useTaskStore.getState().setDubbing({
        inProgress: false,
        stage,
        percent: percent >= 100 ? percent : 100,
      });
    }
  } catch (err) {
    console.error('[progress-buffer] dubbing progress error:', err);
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
  }
});

// Map backend i18n stage tokens to localized, human-readable strings for logs
function translateBackendStage(
  stage: string,
  t: (key: string, opts?: any) => string
): string {
  if (!stage?.startsWith('__i18n__:')) return stage;
  const parts = stage.split(':');
  const messageType = parts[1];
  try {
    switch (messageType) {
      case 'transcribed_chunks': {
        const done = parseInt(parts[2], 10) || 0;
        const total = parseInt(parts[3], 10) || 0;
        return t('progress.transcribedChunks', { done, total });
      }
      case 'scrubbing_hallucinations': {
        const done = parseInt(parts[2], 10) || 0;
        const total = parseInt(parts[3], 10) || 0;
        return t('progress.scrubbingHallucinations', { done, total });
      }
      case 'translation_cleanup': {
        const done = parseInt(parts[2], 10) || 0;
        const total = parseInt(parts[3], 10) || 0;
        return t('progress.translationCleanup', { done, total });
      }
      case 'repairing_captions': {
        const iteration = parseInt(parts[2], 10) || 0;
        const maxIterations = parseInt(parts[3], 10) || 0;
        const done = parseInt(parts[4], 10) || 0;
        const total = parseInt(parts[5], 10) || 0;
        return t('progress.repairingCaptions', {
          iteration,
          maxIterations,
          done,
          total,
        });
      }
      case 'gap_repair': {
        const iteration = parseInt(parts[2], 10) || 0;
        const done = parseInt(parts[3], 10) || 0;
        const total = parseInt(parts[4], 10) || 0;
        return t('progress.gapRepair', { iteration, done, total });
      }
      default:
        return stage;
    }
  } catch {
    return stage;
  }
}

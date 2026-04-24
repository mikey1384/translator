import { parseSrt } from '../../shared/helpers';
import { ERROR_CODES } from '../../shared/constants';
import * as SubtitlesIPC from '@ipc/subtitles';
import { useTaskStore } from '../state/task-store';
import { useSubStore } from '../state/subtitle-store';
import { useUIStore } from '../state/ui-store';
import { useAiStore } from '../state/ai-store';
import * as SystemIPC from '@ipc/system';
import { i18n } from '../i18n';
import { logTask, logPhase } from '../utils/logger';
import { openCreditRanOut } from '../state/modal-store';
import { hasApiKeyModeActiveCoverage } from '../state/byo-runtime';
import {
  isCreditRefreshableOperation,
  shouldRefreshStage5CreditsForOperation,
} from '../utils/creditRefreshOperations';

type ProgressPayload = Parameters<
  Parameters<typeof SubtitlesIPC.onGenerateProgress>[0]
>[1];

let queued: ProgressPayload | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let isFlushing = false;
let lastParsed = 0;
let lastTranscribe = { id: null as string | null, stage: '' };
let lastTranslate = { id: null as string | null, stage: '' };
// Track how many tail-segments have been appended per operation
const tailCounts: Record<string, number> = Object.create(null);
const ACTIVE_CREDIT_REFRESH_INTERVAL_MS = 5_000;
const terminalCreditRefreshOperations = new Set<string>();
const pendingTerminalCreditRefreshOperations = new Set<string>();
const creditRefreshInFlightOperations = new Set<string>();
const activeCreditRefreshTimers = new Map<
  string,
  ReturnType<typeof setInterval>
>();

function isOperationStillActive(operationId: string): boolean {
  const state = useTaskStore.getState();

  if (operationId.startsWith('translate-')) {
    return (
      state.translation.inProgress === true &&
      state.translation.id === operationId
    );
  }

  if (operationId.startsWith('transcribe-')) {
    return (
      state.transcription.inProgress === true &&
      state.transcription.id === operationId
    );
  }

  if (operationId.startsWith('dub-')) {
    return state.dubbing.inProgress === true && state.dubbing.id === operationId;
  }

  return false;
}

function stopActiveCreditRefresh(operationId?: string | null) {
  if (!operationId) return;

  const timer = activeCreditRefreshTimers.get(operationId);
  if (!timer) return;

  clearInterval(timer);
  activeCreditRefreshTimers.delete(operationId);
}

function requestAuthoritativeCreditRefresh(
  operationId?: string | null,
  options: { terminal?: boolean } = {}
) {
  if (!shouldRefreshStage5CreditsForOperation(operationId)) {
    return;
  }

  if (options.terminal && terminalCreditRefreshOperations.has(operationId)) {
    return;
  }

  if (creditRefreshInFlightOperations.has(operationId)) {
    if (options.terminal) {
      pendingTerminalCreditRefreshOperations.add(operationId);
    }
    return;
  }

  if (options.terminal) {
    terminalCreditRefreshOperations.add(operationId);
  }

  creditRefreshInFlightOperations.add(operationId);
  void SystemIPC.refreshCreditSnapshot()
    .catch(error => {
      if (options.terminal) {
        terminalCreditRefreshOperations.delete(operationId);
      }
      console.warn(
        '[progress-buffer] Failed to refresh authoritative credit snapshot:',
        error
      );
    })
    .finally(() => {
      creditRefreshInFlightOperations.delete(operationId);
      if (pendingTerminalCreditRefreshOperations.delete(operationId)) {
        requestAuthoritativeCreditRefresh(operationId, { terminal: true });
      }
    });
}

function startActiveCreditRefresh(operationId?: string | null) {
  if (
    !operationId ||
    !isCreditRefreshableOperation(operationId) ||
    activeCreditRefreshTimers.has(operationId) ||
    !shouldRefreshStage5CreditsForOperation(operationId)
  ) {
    return;
  }

  requestAuthoritativeCreditRefresh(operationId);
  const timer = setInterval(() => {
    if (!isOperationStillActive(operationId)) {
      stopActiveCreditRefresh(operationId);
      return;
    }

    requestAuthoritativeCreditRefresh(operationId);
  }, ACTIVE_CREDIT_REFRESH_INTERVAL_MS);
  activeCreditRefreshTimers.set(operationId, timer);
}

function finishCreditRefresh(operationId?: string | null) {
  stopActiveCreditRefresh(operationId);
  requestAuthoritativeCreditRefresh(operationId, { terminal: true });
}

function shouldFinishCreditRefreshForPacket({
  stageLower,
  error,
  isComplete,
}: {
  stageLower: string;
  error?: unknown;
  isComplete: boolean;
}): boolean {
  if (isComplete) return true;
  if (typeof error === 'string' && error.trim()) return true;

  return (
    stageLower.includes('process_cancelled') ||
    stageLower.includes('cancelled') ||
    stageLower.includes('canceled') ||
    stageLower.includes('cancel') ||
    stageLower.includes('error') ||
    stageLower.includes('failed') ||
    stageLower.includes('failure') ||
    stageLower.includes('insufficient')
  );
}

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
      current,
      total,
      unit,
      phaseKey,
      etaSeconds,
      partialResult,
      error,
      model,
    } = queued as any;
    const stageLower = (stage ?? '').toLowerCase();

    // If we detect credits exhaustion, trigger the global modal once
    if (
      typeof error === 'string' &&
      error.includes(ERROR_CODES.INSUFFICIENT_CREDITS)
    ) {
      try {
        const s = useAiStore.getState();
        const usingApiKey = hasApiKeyModeActiveCoverage(s);
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
    const shouldFinishCreditRefresh = shouldFinishCreditRefreshForPacket({
      stageLower,
      error,
      isComplete,
    });

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
        current,
        total,
        unit,
        phaseKey,
        etaSeconds,
        model,
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
        finishCreditRefresh(operationId);
        queued = null;
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        try {
          if (operationId && !/cancel/.test(stageLower)) {
            logTask('complete', 'translation', { operationId });
          }
        } catch {
          // Do nothing
        }
        return;
      }
      if (shouldFinishCreditRefresh) {
        finishCreditRefresh(operationId);
      } else {
        startActiveCreditRefresh(operationId);
      }
      // If the task has been marked complete (inProgress=false), ignore any late non-final updates
      if (!inProgress) {
        queued = null;
        return;
      }
    } else if (isTranscribe) {
      const active = useTaskStore.getState().transcription.id;
      const inProgress = useTaskStore.getState().transcription.inProgress;
      if (inProgress && active && operationId && operationId !== active) {
        queued = null;
        return;
      }
      const isNewIdleTranscriptionOperation = Boolean(
        !inProgress && operationId && operationId !== active
      );
      // Ignore stale non-final packets after transcription has been finalized.
      if (
        !inProgress &&
        !isComplete &&
        !shouldFinishCreditRefresh &&
        !isNewIdleTranscriptionOperation
      ) {
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
        current,
        total,
        unit,
        phaseKey,
        etaSeconds,
        model,
      });
      if (!isComplete && shouldFinishCreditRefresh) {
        finishCreditRefresh(operationId);
      } else if (!isComplete) {
        startActiveCreditRefresh(operationId);
      }
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

      // Default transcription flows can open Edit immediately so users can
      // watch incremental results. Highlight-owned runs intentionally skip
      // this pre-mount open; MainPanels will surface Edit once subtitles exist.
      try {
        const workflowOwner =
          useTaskStore.getState().transcription.workflowOwner;
        if (workflowOwner !== 'highlight') {
          const { showEditPanel, setEditPanelOpen } = useUIStore.getState();
          if (!showEditPanel) setEditPanelOpen(true);
        }
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
      }
    }

    // After completion, stop applying any further queued updates
    if (isComplete) {
      finishCreditRefresh(operationId);
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
    const model = (progress as any)?.model as string | undefined;
    const current =
      typeof progress?.current === 'number' ? progress.current : undefined;
    const total =
      typeof progress?.total === 'number' ? progress.total : undefined;
    const unit =
      typeof (progress as any)?.unit === 'string'
        ? ((progress as any).unit as string)
        : undefined;
    const phaseKey =
      typeof (progress as any)?.phaseKey === 'string'
        ? ((progress as any).phaseKey as string)
        : undefined;
    const etaSeconds =
      typeof (progress as any)?.etaSeconds === 'number'
        ? (progress as any).etaSeconds
        : undefined;

    if (
      typeof error === 'string' &&
      error.includes(ERROR_CODES.INSUFFICIENT_CREDITS)
    ) {
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
      current,
      total,
      unit,
      phaseKey,
      etaSeconds,
      model,
    });

    const lower = stage.toLowerCase();
    if (
      percent >= 100 ||
      /complete|done/.test(lower) ||
      /cancel/.test(lower) ||
      typeof error === 'string'
    ) {
      finishCreditRefresh(operationId);
      useTaskStore.getState().setDubbing({
        inProgress: false,
        stage,
        percent: percent >= 100 ? percent : 100,
      });
    } else {
      startActiveCreditRefresh(operationId);
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

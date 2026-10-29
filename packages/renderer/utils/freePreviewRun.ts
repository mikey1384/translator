import * as SubtitlesIPC from '../ipc/subtitles';
import * as SystemIPC from '../ipc/system';
import {
  useAiStore,
  useCreditStore,
  useSubStore,
  useTaskStore,
  useUIStore,
  useVideoStore,
} from '../state';
import { resolveTranscriptionProvider } from '../state/byo-runtime';
import {
  freePreviewKey,
  useFreePreviewStore,
  type FreePreview,
  type FreePreviewFailure,
} from '../state/free-preview-store';
import { i18n } from '../i18n';
import {
  describeVideoCost,
  needsTailTranscription,
  planFreePreview,
  type FreePreviewPlan,
  type VideoCost,
} from './freePreview';
import { translateMissingUntranslated } from './translateMissing';
import { persistMountedTranslation } from '../containers/GenerateSubtitles/utils/subtitleGeneration';
import { registerStage5CreditRefreshOperation } from './creditRefreshOperations';
import { logTask } from './logger';
import { resolveTaskFailure } from './taskFailure';
import { saveMountedSubtitleDocument } from './subtitle-documents';

const DEV_TEST_CREDITS_KEY = 'dev.freePreviewTestCredits';

/**
 * The balance the preview plans with. Development builds can pretend to hold
 * less (localStorage 'dev.freePreviewTestCredits') to exercise the preview on
 * a device with real credits; packaged builds always use the real balance.
 */
export function freePreviewPlanningCredits(credits: number): number {
  try {
    if ((window as any).env?.isPackaged) return credits;
    const raw = localStorage.getItem(DEV_TEST_CREDITS_KEY);
    const override = raw === null ? NaN : Number(raw);
    return Number.isFinite(override) ? Math.min(credits, override) : credits;
  } catch {
    return credits;
  }
}

/** The preview key of what is open in the workspace. */
export function currentFreePreviewKey(): string | null {
  const video = useVideoStore.getState();
  return freePreviewKey({
    originalPath: video.originalPath,
    path: video.path,
    sourceUrl: video.sourceUrl,
  });
}

/**
 * Whole run, preview or offer-only. Anything but Stage5 credit transcription
 * with a known balance runs whole, as before.
 */
export function decideFreePreview(
  durationSecs: number | null | undefined,
  snapshot?: { creditBalance: number; authoritative: boolean } | null
): FreePreviewPlan {
  if (!durationSecs || durationSecs <= 0) return { kind: 'full' };
  const ai = useAiStore.getState() as any;
  if (resolveTranscriptionProvider(ai) !== 'stage5') return { kind: 'full' };
  const { credits, authoritative } =
    snapshot === undefined
      ? useCreditStore.getState()
      : {
          credits: snapshot?.creditBalance,
          authoritative: snapshot?.authoritative,
        };
  if (!authoritative || typeof credits !== 'number') return { kind: 'full' };
  return planFreePreview({
    durationSecs,
    credits: freePreviewPlanningCredits(credits),
    qualityEnabled: Boolean(useUIStore.getState().qualityTranslation),
  });
}

/**
 * The cost of subtitling a video of this length for this user right now, or
 * null when it isn't paid in Stage5 credits (API keys) or the balance is
 * unknown.
 */
export function currentVideoCost(
  durationSecs: number | null | undefined
): VideoCost | null {
  if (!durationSecs || durationSecs <= 0) return null;
  const ai = useAiStore.getState() as any;
  if (resolveTranscriptionProvider(ai) !== 'stage5') return null;
  const { credits, authoritative } = useCreditStore.getState();
  if (!authoritative || typeof credits !== 'number') return null;
  return describeVideoCost({
    durationSecs,
    credits: freePreviewPlanningCredits(credits),
    qualityEnabled: Boolean(useUIStore.getState().qualityTranslation),
  });
}

export function recordFreePreview(
  item: Omit<FreePreview, 'updatedAt' | 'key'>
): void {
  const key = currentFreePreviewKey();
  if (!key) return;
  useFreePreviewStore.getState().save({ ...item, key });
  void SystemIPC.trackPurchaseEvent('free_preview_ready', {
    placement: 'free-preview-offer',
  }).catch(() => {});
}

export function clearFreePreviewForCurrentVideo(): void {
  const key = currentFreePreviewKey();
  if (key) useFreePreviewStore.getState().clear(key);
}

let resumeInFlight = false;

/** A dropped connection reads differently from any other stop. */
export function classifyFreePreviewFailure(error: unknown): FreePreviewFailure {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /network|offline|internet|timed? ?out|ENOTFOUND|ECONN|EAI_AGAIN|fetch failed|socket/i.test(
    message
  )
    ? 'network'
    : 'other';
}

/**
 * Transcribe from the last preview line (the cut may have clipped it) to the
 * end and append it. Marks the preview as transcribed to the end, so a retry
 * after a failed translation doesn't pay for the tail again.
 */
async function transcribePreviewTail(
  key: string,
  preview: FreePreview,
  videoPath: string
): Promise<void> {
  const subs = useSubStore.getState();
  const video = useVideoStore.getState();
  const last = subs.segments[subs.order[subs.order.length - 1]];
  let start = preview.coveredSecs;
  // The cut may have clipped the last line: redo it, but only drop the old
  // copy once the new transcription is in hand.
  let replaceId: string | null = null;
  if (last) {
    if (last.end >= preview.coveredSecs - 2) {
      start = Math.max(0, last.start);
      replaceId = last.id;
    } else {
      start = last.end;
    }
  }

  const operationId = `transcribe-${Date.now()}-tail`;
  registerStage5CreditRefreshOperation(operationId);
  useTaskStore.getState().setTranscription({
    id: operationId,
    stage: i18n.t('generateSubtitles.status.starting', 'Starting...'),
    percent: 0,
    inProgress: true,
    isCompleted: false,
  });
  logTask('start', 'transcription', {
    operationId,
    mode: 'free-preview-finish',
    start,
  });

  const result = await SubtitlesIPC.transcribeRemaining({
    videoPath,
    sourceUrl: video.sourceUrl,
    start,
    operationId,
  });
  if (!result?.success) {
    // Opens the credits dialog when the balance ran short mid-finish.
    const failure = resolveTaskFailure({
      error: result?.error,
      cancelled: result?.cancelled,
      operationId,
      task: 'transcription',
    });
    useTaskStore.getState().setTranscription({
      stage: failure.stage,
      percent: 100,
      inProgress: false,
      isCompleted: false,
    });
    throw new Error(result?.error || 'Transcription stopped');
  }
  const added = result.segments ?? [];
  if (replaceId && added.length > 0) useSubStore.getState().remove(replaceId);
  if (added.length > 0) useSubStore.getState().appendSegments(added);
  if (result.transcriptionCoverage) {
    useSubStore
      .getState()
      .setTranscriptionCoverage(result.transcriptionCoverage);
  }
  // Persist the paid result before marking the tail complete or translating.
  // A retry/restart must not rely on the last speech time or lose the tail.
  const saved = await saveMountedSubtitleDocument({ keepDirty: true });
  if (!saved.success)
    throw new Error(saved.error || 'Failed to save transcription');
  useTaskStore.getState().setTranscription({
    stage: i18n.t('generateSubtitles.status.completed', 'Completed'),
    percent: 100,
    inProgress: false,
    isCompleted: true,
  });
  const current = useFreePreviewStore.getState().items[key];
  if (current) {
    useFreePreviewStore.getState().save({
      ...current,
      coveredSecs: current.durationSecs,
      transcribedToEnd: true,
    });
  }
}

/**
 * Finish a previewed video after a purchase: transcribe from the last
 * preview line (the cut may have clipped it) to the end, append, translate
 * only the new lines, and save the whole thing like a normal run.
 */
export async function resumeFreePreview(key: string): Promise<boolean> {
  const preview = useFreePreviewStore.getState().items[key];
  if (!preview || resumeInFlight) return false;
  if (currentFreePreviewKey() !== key) return false;
  resumeInFlight = true;
  const store = useFreePreviewStore.getState();
  store.setStatus(key, 'resuming');
  void SystemIPC.trackPurchaseEvent('free_preview_resumed', {
    placement: 'free-preview-offer',
  }).catch(() => {});

  try {
    const subs = useSubStore.getState();
    const video = useVideoStore.getState();
    const videoPath = video.originalPath ?? video.path;

    // Nothing was covered: this is simply the whole run.
    if (subs.order.length === 0 || preview.coveredSecs <= 0) {
      if (!videoPath) throw new Error('No video to finish');
      store.clear(key);
      useUIStore.getState().setTargetLanguage(preview.language);
      useUIStore
        .getState()
        .requestHomeRun({ kind: 'mounted', path: videoPath });
      return true;
    }
    if (!videoPath) throw new Error('No video to finish');
    // A retry after the rest was already transcribed only translates; the
    // paid tail is never transcribed (or charged) twice.
    const lastId = subs.order[subs.order.length - 1];
    if (
      needsTailTranscription({
        transcribedToEnd: preview.transcribedToEnd,
        durationSecs: preview.durationSecs,
        lastEndSecs: lastId ? (subs.segments[lastId]?.end ?? null) : null,
        coverage: subs.transcriptionCoverage,
      })
    ) {
      await transcribePreviewTail(key, preview, videoPath);
    }

    useUIStore.getState().setTargetLanguage(preview.language);
    const translated = await translateMissingUntranslated();
    if (!translated) throw new Error('Translation stopped');

    await persistMountedTranslation(preview.language);
    store.clear(key);
    void SystemIPC.trackPurchaseEvent('free_preview_completed', {
      placement: 'free-preview-offer',
    }).catch(() => {});
    return true;
  } catch (error) {
    console.error('[freePreview] finishing the video failed:', error);
    if (useFreePreviewStore.getState().items[key]) {
      useFreePreviewStore
        .getState()
        .setStatus(key, 'failed', classifyFreePreviewFailure(error));
    }
    void SystemIPC.trackPurchaseEvent('free_preview_failed', {
      placement: 'free-preview-offer',
    }).catch(() => {});
    return false;
  } finally {
    resumeInFlight = false;
  }
}

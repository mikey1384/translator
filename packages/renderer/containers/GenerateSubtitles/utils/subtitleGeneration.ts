import { useTaskStore } from '../../../state';
import * as SubtitlesIPC from '../../../ipc/subtitles';
import { parseSrt } from '../../../../shared/helpers';
import { i18n } from '../../../i18n';
import { buildSrt } from '../../../../shared/helpers';
import { useSubStore, useUIStore, useVideoStore } from '../../../state';
import { openUnsavedSrtConfirm } from '../../../state/modal-store';
import { saveCurrentSubtitles } from '../../../utils/saveSubtitles';
import { useUrlStore } from '../../../state/url-store';
import * as SystemIPC from '../../../ipc/system';
import * as LearningIPC from '../../../ipc/learning';
import type { SrtSegment } from '@shared-types/app';

export interface GenerateSubtitlesParams {
  videoFile: File | null;
  videoFilePath: string | null;
  targetLanguage: string;
  operationId: string;
}

export interface GenerateSubtitlesResult {
  success: boolean;
  cancelled?: boolean;
  subtitles?: string;
}

export async function executeSrtTranslation({
  segments,
  targetLanguage,
  operationId,
}: {
  segments: any[];
  targetLanguage: string;
  operationId: string;
}): Promise<{ success: boolean; subtitles?: string; cancelled?: boolean }> {
  // Prevent translation while transcription is in progress
  if (useTaskStore.getState().transcription.inProgress) {
    return { success: false };
  }
  const srtContent = buildSrt({ segments, mode: 'dual' });

  // Initialize translation task so progress-buffer accepts progress updates
  useTaskStore.getState().setTranslation({
    id: operationId,
    stage: i18n.t('generateSubtitles.status.starting'),
    percent: 0,
    inProgress: true,
  });

  try {
    const { qualityTranslation } = useUIStore.getState();
    const res = await SubtitlesIPC.translateSubtitles({
      subtitles: srtContent,
      targetLanguage,
      operationId,
      qualityTranslation,
    });
    if (res?.translatedSubtitles) {
      const finalSegments = parseSrt(res.translatedSubtitles);
      // Preserve linkage to the source video if present; do not invent a new one
      const srcVideo = useSubStore.getState().sourceVideoPath ?? null;
      useSubStore.getState().load(finalSegments, null, 'fresh', srcVideo);
      useTaskStore.getState().setTranslation({
        stage: i18n.t('generateSubtitles.status.completed'),
        percent: 100,
        inProgress: false,
      });
      const videoPath = srcVideo ?? useVideoStore.getState().path ?? null;
      if (videoPath) {
        void LearningIPC.recordTranslation({
          videoPath,
          targetLanguage,
          translation: res.translatedSubtitles,
        }).catch(err => {
          console.error(
            '[subtitleGeneration] Failed to record translation',
            err
          );
        });
      }
      return { success: true, subtitles: res.translatedSubtitles };
    }
    useTaskStore.getState().setTranslation({ inProgress: false });
    return { success: false };
  } catch {
    useTaskStore.getState().setTranslation({
      stage: i18n.t('generateSubtitles.status.error'),
      percent: 100,
      inProgress: false,
    });
    return { success: false };
  }
}

export async function executeDubGeneration({
  segments,
  operationId,
  videoPath,
  voice,
}: {
  segments: any[];
  operationId: string;
  videoPath?: string | null;
  voice?: string;
}): Promise<{
  success: boolean;
  videoPath?: string;
  audioPath?: string;
  cancelled?: boolean;
}> {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { success: false };
  }

  // Prevent dubbing while transcription is running to avoid overload
  if (useTaskStore.getState().transcription.inProgress) {
    return { success: false };
  }

  useTaskStore.getState().setDubbing({
    id: operationId,
    stage: i18n.t('generateSubtitles.status.starting'),
    percent: 0,
    inProgress: true,
  });

  const payloadSegments = segments.map((seg: any, idx: number) => ({
    start: Number(seg?.start ?? 0),
    end: Number(seg?.end ?? 0),
    original: String(seg?.original ?? ''),
    translation: String(seg?.translation ?? ''),
    index: typeof seg?.index === 'number' ? seg.index : idx + 1,
    targetDuration:
      typeof seg?.start === 'number' &&
      typeof seg?.end === 'number' &&
      Number.isFinite(seg.start) &&
      Number.isFinite(seg.end) &&
      seg.end > seg.start
        ? Number(seg.end) - Number(seg.start)
        : undefined,
  }));

  const { dubVoice, dubAmbientMix } = useUIStore.getState();
  const quality = 'standard';
  const selectedVoice = voice ?? dubVoice ?? 'alloy';

  try {
    const res = await SubtitlesIPC.dubSubtitles({
      segments: payloadSegments,
      voice: selectedVoice,
      operationId,
      videoPath: videoPath ?? null,
      quality,
      ambientMix: dubAmbientMix,
    });

    if (res?.success) {
      useTaskStore.getState().setDubbing({
        stage: i18n.t('generateSubtitles.status.completed'),
        percent: 100,
        inProgress: false,
      });

      useVideoStore.getState().registerDubbedResult({
        videoPath: res.videoPath ?? null,
        audioPath: res.audioPath ?? null,
      });

      if (res.videoPath) {
        try {
          await useVideoStore.getState().setActiveTrack('dubbed');
        } catch (err) {
          console.error(
            '[executeDubGeneration] Failed to activate dubbed track:',
            err
          );
        }
      }

      return {
        success: true,
        videoPath: res.videoPath,
        audioPath: res.audioPath,
        cancelled: res.cancelled,
      };
    }

    if (res?.error) {
      try {
        useUrlStore.getState().setError(res.error);
      } catch {
        // ignore store errors
      }
    }
    useTaskStore.getState().setDubbing({
      stage: res?.cancelled
        ? i18n.t('generateSubtitles.status.cancelled')
        : i18n.t('generateSubtitles.status.error'),
      percent: 100,
      inProgress: false,
    });
    return { success: false, cancelled: res?.cancelled };
  } catch (error) {
    console.error('[executeDubGeneration] Error:', error);
    try {
      useUrlStore
        .getState()
        .setError(
          error instanceof Error
            ? error.message
            : 'Failed to generate dubbed audio.'
        );
    } catch {
      // ignore
    }
    useTaskStore.getState().setDubbing({
      stage: i18n.t('generateSubtitles.status.error'),
      percent: 100,
      inProgress: false,
    });
    return { success: false };
  }
}

export async function executeSubtitleGeneration({
  videoFile,
  videoFilePath,
  targetLanguage,
  operationId,
}: GenerateSubtitlesParams): Promise<GenerateSubtitlesResult> {
  const { setTranscription } = useTaskStore.getState();
  // Ensure translation slice is not considered active during transcription-only
  useTaskStore.getState().setTranslation({ inProgress: false });

  // Initialize progress tracking (transcription-only)
  setTranscription({
    id: operationId,
    stage: i18n.t('generateSubtitles.status.starting'),
    percent: 0,
    inProgress: true,
  });

  try {
    // Prepare options for subtitle generation
    const opts: any = { targetLanguage, streamResults: true };
    if (videoFilePath) {
      opts.videoPath = videoFilePath;
    } else if (videoFile) {
      opts.videoFile = videoFile;
    }
    opts.operationId = operationId;
    // Quality vs speed toggle for transcription
    try {
      opts.qualityTranscription = useUIStore.getState().qualityTranscription;
    } catch {
      // do nothing
    }

    // Generate subtitles
    const result = await SubtitlesIPC.generate(opts);

    const rawSegments = Array.isArray((result as any)?.segments)
      ? ((result as any).segments as SrtSegment[])
      : null;

    let finalSegments: SrtSegment[] = [];

    if (
      typeof result.subtitles === 'string' &&
      result.subtitles.trim().length > 0
    ) {
      try {
        finalSegments = parseSrt(result.subtitles);
      } catch (err) {
        console.warn(
          '[executeSubtitleGeneration] Failed to parse subtitles, falling back to raw segments.',
          err
        );
      }
    }

    if (finalSegments.length === 0 && rawSegments?.length) {
      finalSegments = rawSegments.map((seg, idx) =>
        normalizeRawSegment(seg, idx)
      );
    }

    if (rawSegments?.length) {
      finalSegments = mergeWordTimingMetadata(finalSegments, rawSegments);
    }

    if (typeof result.subtitles === 'string' || Array.isArray(rawSegments)) {
      const vpath = videoFilePath ?? useVideoStore.getState().path ?? null;
      useSubStore.getState().load(finalSegments, null, 'fresh', vpath);

      const segmentCount = finalSegments.length;
      setTranscription({
        id: operationId,
        stage:
          segmentCount === 0
            ? i18n.t(
                'generateSubtitles.status.completedNoSpeech',
                'Completed (no speech detected)'
              )
            : i18n.t('generateSubtitles.status.completed'),
        percent: 100,
        inProgress: false,
      });

      const transcriptContent =
        typeof result.subtitles === 'string' &&
        result.subtitles.trim().length > 0
          ? result.subtitles
          : finalSegments.length > 0
            ? buildSrt({ segments: finalSegments, mode: 'dual' })
            : '';

      if (vpath) {
        const videoState = useVideoStore.getState();
        const inferredName = (() => {
          const rawName =
            (videoState.file as any)?.name ??
            vpath.split(/[\\/]/).pop() ??
            'video';
          return typeof rawName === 'string' && rawName.trim()
            ? rawName.trim()
            : 'video';
        })();
        const sourceType = videoState.sourceKind ?? 'unknown';
        void LearningIPC.recordTranscription({
          videoPath: vpath,
          videoFilename: inferredName,
          sourceType,
          transcript: transcriptContent,
          transcriptLanguage: 'original',
        }).catch(err => {
          console.error(
            '[subtitleGeneration] Failed to record transcription',
            err
          );
        });
      }

      return { success: true, subtitles: transcriptContent };
    }

    // Fallback: treat as failure so caller surfaces error to user
    const stage = result.cancelled
      ? i18n.t('generateSubtitles.status.cancelled')
      : i18n.t('generateSubtitles.status.error');
    const percent = result.cancelled ? 0 : 100;

    setTranscription({
      id: operationId,
      stage,
      percent,
      inProgress: false,
    });
    try {
      const errMsg =
        (result as any)?.error ||
        'Subtitle generation did not return final segments with timings.';
      useUrlStore.getState().setError(errMsg);
    } catch {
      // ignore
    }
    return { success: false, cancelled: result.cancelled };
  } catch (error) {
    console.error('Error generating subtitles:', error);

    setTranscription({
      id: operationId,
      stage: i18n.t('generateSubtitles.status.error'),
      percent: 100,
      inProgress: false,
    });

    return { success: false };
  }
}

function normalizeRawSegment(seg: any, fallbackIdx: number): SrtSegment {
  const makeId = () => {
    const uuid =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `seg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return uuid;
  };

  return {
    id: typeof seg?.id === 'string' && seg.id.length ? seg.id : makeId(),
    index: typeof seg?.index === 'number' ? seg.index : fallbackIdx + 1,
    start: Number(seg?.start ?? 0),
    end: Number(seg?.end ?? 0),
    original: typeof seg?.original === 'string' ? seg.original : '',
    translation:
      typeof seg?.translation === 'string' ? seg.translation : undefined,
    avg_logprob:
      typeof seg?.avg_logprob === 'number' ? seg.avg_logprob : undefined,
    no_speech_prob:
      typeof seg?.no_speech_prob === 'number' ? seg.no_speech_prob : undefined,
    words: Array.isArray(seg?.words) ? seg.words : undefined,
  };
}

function mergeWordTimingMetadata(
  parsed: SrtSegment[],
  raw: SrtSegment[]
): SrtSegment[] {
  if (!parsed.length || !raw.length) {
    return parsed;
  }

  const byIndex = new Map<number, SrtSegment>();
  for (const seg of raw) {
    if (seg && typeof seg.index === 'number' && !byIndex.has(seg.index)) {
      byIndex.set(seg.index, seg);
    }
  }

  const used = new WeakSet<object>();

  const findCandidate = (segment: SrtSegment): SrtSegment | null => {
    if (typeof segment.index === 'number') {
      const indexed = byIndex.get(segment.index);
      if (
        indexed &&
        !used.has(indexed) &&
        timingsRoughlyMatch(indexed, segment)
      ) {
        used.add(indexed);
        return indexed;
      }
    }

    for (const candidate of raw) {
      if (!candidate || used.has(candidate)) continue;
      if (timingsRoughlyMatch(candidate, segment)) {
        used.add(candidate);
        return candidate;
      }
    }

    return null;
  };

  return parsed.map(segment => {
    const source = findCandidate(segment);
    if (!source) return segment;

    const merged: SrtSegment & {
      origWords?: Array<{ start: number; end: number; word: string }>;
      transWords?: Array<{ start: number; end: number; word: string }>;
    } = { ...segment };

    if (Array.isArray((source as any).words) && (source as any).words.length) {
      merged.words = (source as any).words;
    }

    const origWords = Array.isArray((source as any).origWords)
      ? (source as any).origWords
      : Array.isArray((source as any).words)
        ? (source as any).words
        : undefined;
    if (origWords?.length) {
      merged.origWords = origWords;
    }

    if (
      Array.isArray((source as any).transWords) &&
      (source as any).transWords.length
    ) {
      merged.transWords = (source as any).transWords;
    }

    if (typeof (source as any).avg_logprob === 'number') {
      merged.avg_logprob = (source as any).avg_logprob;
    }
    if (typeof (source as any).no_speech_prob === 'number') {
      merged.no_speech_prob = (source as any).no_speech_prob;
    }

    return merged;
  });
}

function timingsRoughlyMatch(a: SrtSegment, b: SrtSegment): boolean {
  const tol = 0.4; // seconds
  const aStart = Number(a?.start ?? NaN);
  const aEnd = Number(a?.end ?? NaN);
  if (!Number.isFinite(aStart) || !Number.isFinite(aEnd)) return false;
  return Math.abs(aStart - b.start) <= tol && Math.abs(aEnd - b.end) <= tol;
}

export async function startTranscriptionFlow({
  videoFile,
  videoFilePath,
  durationSecs,
  hoursNeeded,
  operationId,
  metadataStatus,
}: {
  videoFile: File | null;
  videoFilePath: string | null;
  durationSecs: number | null;
  hoursNeeded: number | null;
  operationId: string;
  metadataStatus?: {
    status?: 'idle' | 'fetching' | 'waiting' | 'success' | 'failed';
    code?: string;
    message?: string;
  };
}): Promise<GenerateSubtitlesResult> {
  // Ensure the Edit panel is visible so users can see live updates
  try {
    const { setEditPanelOpen } = useUIStore.getState();
    setEditPanelOpen(true);
  } catch {
    // Do nothing
  }

  // If there are mounted subtitles, prompt to save/discard before proceeding
  const hasMounted = useSubStore.getState().order.length > 0;
  if (hasMounted) {
    const choice = await openUnsavedSrtConfirm();
    if (choice === 'cancel') return { success: false };
    if (choice === 'save') {
      const saved = await saveCurrentSubtitles();
      if (!saved) return { success: false };
    }
    clearMountedSrtShared();
    try {
      useVideoStore.getState().clearDubbedMedia();
    } catch {
      // Ignore inability to clear dubbed media
    }
  }

  // Validate inputs
  const validation = validateGenerationInputs(
    videoFile,
    videoFilePath,
    durationSecs,
    hoursNeeded,
    metadataStatus
  );

  if (!validation.isValid) {
    const msg =
      validation.errorMessage || i18n.t('generateSubtitles.calculatingCost');
    await SystemIPC.showMessage(msg);
    return { success: false };
  }

  return executeSubtitleGeneration({
    videoFile,
    videoFilePath,
    targetLanguage: 'original',
    operationId,
  });
}

// Removed old inline save; centralized in utils/saveSubtitles.ts

function clearMountedSrtShared() {
  useSubStore.setState({
    segments: {},
    order: [],
    activeId: null,
    playingId: null,
    originalPath: null,
  } as any);
  useTaskStore.getState().setTranslation({
    id: null,
    stage: '',
    percent: 0,
    inProgress: false,
    batchStartIndex: undefined,
  });
  useTaskStore.getState().setTranscription({
    id: null,
    stage: '',
    percent: 0,
    inProgress: false,
  });
}

export function validateGenerationInputs(
  videoFile: File | null,
  videoFilePath: string | null,
  durationSecs: number | null,
  hoursNeeded: number | null,
  metadataStatus?: {
    status?: 'idle' | 'fetching' | 'waiting' | 'success' | 'failed';
    code?: string;
    message?: string;
  } | null
): { isValid: boolean; errorMessage?: string } {
  if (!videoFile && !videoFilePath) {
    return {
      isValid: false,
      errorMessage: i18n.t('generateSubtitles.validation.pleaseSelectVideo'),
    };
  }

  if (metadataStatus) {
    if (metadataStatus.code === 'icloud-placeholder') {
      return {
        isValid: false,
        errorMessage: i18n.t(
          'generateSubtitles.validation.icloudPlaceholder',
          'This file is stored in iCloud. In Finder, click “Download” and wait for the cloud icon to finish, then try again.'
        ),
      };
    }
    if (
      metadataStatus.status === 'fetching' ||
      metadataStatus.status === 'waiting'
    ) {
      return {
        isValid: false,
        errorMessage: i18n.t('generateSubtitles.validation.processingDuration'),
      };
    }
    if (
      metadataStatus.status === 'failed' &&
      metadataStatus.message &&
      metadataStatus.message.trim().length > 0
    ) {
      return {
        isValid: false,
        errorMessage: metadataStatus.message,
      };
    }
  }

  if (durationSecs === null || durationSecs <= 0 || hoursNeeded === null) {
    return {
      isValid: false,
      errorMessage: i18n.t('generateSubtitles.validation.processingDuration'),
    };
  }

  return { isValid: true };
}

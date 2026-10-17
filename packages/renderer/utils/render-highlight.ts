import {
  validateHighlightEditorialPlan,
  editorialSourceSignature,
} from '../../shared/helpers/highlight-editorial';
import type {
  HighlightAspectMode,
  SrtSegment,
  SubtitleDisplayMode,
  TranscriptHighlight,
} from '@shared-types/app';
import type {
  SubtitleStylePresetKey,
  SubtitleTypeface,
} from '../../shared/constants/subtitle-styles';
import { buildSrt } from '../../shared/helpers';
import {
  highlightCaptionSignature,
  highlightClipArtifactKey,
  highlightClipSelectionSignature,
  highlightClipSourceIdentity,
  rebaseClipSubtitles,
} from '../../shared/helpers/highlight-clips';
import {
  resolveSubtitleRenderSpec,
  serializeSubtitleRenderSpec,
} from '../../shared/helpers/subtitle-render-spec';
import * as SubtitlesIPC from '../ipc/subtitles';
import * as LibraryIPC from '../ipc/subtitle-library';
import * as SystemIPC from '../ipc/system';
import { recordHighlightClip } from '../ipc/highlight-clips';
import subtitleRendererClient from '../clients/subtitle-renderer-client';
import { useTaskStore } from '../state/task-store';
import { useUIStore } from '../state/ui-store';
import { useSubStore } from '../state/subtitle-store';
import { useVideoStore } from '../state/video-store';
import { CancelledError } from '../../shared/cancelled-error';

export type HighlightRenderInput = {
  videoPath: string;
  highlights: TranscriptHighlight[];
  segments: SrtSegment[];
  operationId: string;
  aspectMode: HighlightAspectMode;
  displayMode: SubtitleDisplayMode;
  style: SubtitleStylePresetKey;
  fontSize: number;
  /** Captured when the clip is queued, so a later change can't mix faces. */
  typeface?: SubtitleTypeface;
  targetLanguage: string | null;
  outputPath?: string;
  onStage?: (stage: string) => void;
  checkCancelled?: () => void;
};

export const HIGHLIGHT_RENDER_COMPLETED =
  'translator-highlight-render-completed';
export type HighlightRenderCompletion = {
  sourceVideoPath: string;
  videoPath: string;
  highlights: TranscriptHighlight[];
  aspectMode: HighlightAspectMode;
  captionSignature: string;
  operationId: string;
};

/** The source a render belongs to, captured before any await can switch it. */
function captureClipSourceIdentity(): string {
  const video = useVideoStore.getState();
  const subtitles = useSubStore.getState();
  return highlightClipSourceIdentity({
    fallbackVideoAssetIdentity: subtitles.sourceVideoAssetIdentity,
    fallbackVideoPath: subtitles.sourceVideoPath,
    originalVideoPath: video.originalPath,
    sourceAssetIdentity: video.sourceAssetIdentity,
    sourceUrl: video.sourceUrl,
    libraryEntryId: subtitles.libraryEntryId,
  });
}

/** Remember the finished clip so reopening this source brings it back. */
async function rememberRenderedClip(
  sourceIdentity: string,
  completion: HighlightRenderCompletion
) {
  const single = completion.highlights.length === 1;
  const artifactKey = single
    ? highlightClipArtifactKey(completion.highlights[0])
    : highlightClipSelectionSignature(completion.highlights);
  if (!artifactKey) return;
  try {
    const result = await recordHighlightClip({
      sourceIdentity: sourceIdentity + completion.captionSignature,
      kind: single ? 'single' : 'combined',
      artifactKey,
      // The clips panel shows legacy 'vertical' renders as Shorts Reframe.
      aspectMode:
        completion.aspectMode === 'vertical'
          ? 'vertical_reframe'
          : completion.aspectMode,
      videoPath: completion.videoPath,
    });
    if (!result?.success) throw new Error(result?.error || 'unknown error');
  } catch (error) {
    // The clip itself is fine; only reopening will not find it.
    console.warn('[render-highlight] Could not remember rendered clip:', error);
  }
}

/** The UI and MCP share this local-only cut, caption, and library workflow. */
export async function renderHighlight(input: HighlightRenderInput) {
  const sourceIdentity = captureClipSourceIdentity();
  const tasks = useTaskStore.getState();
  if (
    [
      tasks.merge,
      tasks.transcription,
      tasks.translation,
      tasks.dubbing,
      tasks.summary,
    ].some(task => task.inProgress)
  ) {
    throw new Error('Wait for the current operation before rendering a clip.');
  }
  tasks.setMerge({
    id: input.operationId,
    inProgress: true,
    isCompleted: false,
    percent: 0,
    stage: 'Cutting highlight clip',
  });
  const reportCut = (progress: {
    operationId?: string;
    percent: number;
    stage: string;
  }) => {
    if (progress.operationId !== input.operationId) return;
    useTaskStore.getState().setMerge({
      percent: Math.min(95, progress.percent),
      stage: progress.stage,
    });
  };
  const removeSingle = SubtitlesIPC.onHighlightCutProgress(reportCut);
  const removeCombined = SubtitlesIPC.onCombinedHighlightCutProgress(reportCut);
  try {
    return await runHighlightRender(input, sourceIdentity);
  } finally {
    removeSingle();
    removeCombined();
    const merge = useTaskStore.getState().merge;
    if (
      merge.id === input.operationId ||
      merge.id === `${input.operationId}-captions`
    ) {
      useTaskStore.getState().setMerge({ id: null, inProgress: false });
    }
  }
}

async function runHighlightRender(
  input: HighlightRenderInput,
  sourceIdentity: string
) {
  const { operationId, videoPath, highlights, segments } = input;
  if (!highlights.length) throw new Error('Choose at least one highlight.');
  if (
    highlights.some(h => h.editorial) &&
    (highlights.length !== 1 || input.aspectMode !== 'vertical_reframe')
  )
    throw new Error(
      'Render each editorial Short individually using Shorts Reframe.'
    );
  const editorial = highlights[0].editorial
    ? validateHighlightEditorialPlan(
        highlights[0].editorial,
        highlights[0].end - highlights[0].start
      )
    : undefined;
  if (
    editorial &&
    highlights[0].editorialSourceSignature !==
      editorialSourceSignature(segments, highlights[0].start, highlights[0].end)
  )
    throw new Error(
      'The source captions changed. Review and save the Short edit before rendering again.'
    );
  if (!segments.length)
    throw new Error('Open the saved transcript before cutting a highlight.');
  if (input.outputPath) {
    if (!/\.mp4$/i.test(input.outputPath))
      throw new Error('Clip output must end in .mp4.');
    if (
      window.env.isPackaged &&
      !(await SystemIPC.checkAgentPathAllowed(input.outputPath))
    ) {
      throw new Error('Clip output is outside the agent allowed directories.');
    }
    if (await window.fileApi.fileExists(input.outputPath))
      throw new Error('Clip output already exists. Choose a new path.');
  }
  // Check the chosen language before any expensive local encode.
  const selectedCues = rebaseClipSubtitles(segments, highlights);
  if (!selectedCues.length)
    throw new Error('The chosen interval contains no saved subtitles.');
  if (
    input.displayMode === 'translation' &&
    selectedCues.some(c => c.original.trim() && !c.translation?.trim())
  ) {
    throw new Error(
      'The selected clip has untranslated cues. Translate those saved cues first.'
    );
  }
  input.checkCancelled?.();
  input.onStage?.('cutting');
  const cut =
    highlights.length === 1
      ? await SubtitlesIPC.cutHighlightClip({
          videoPath,
          highlight: highlights[0],
          operationId,
          aspectMode: input.aspectMode,
        })
      : await SubtitlesIPC.cutCombinedHighlights({
          videoPath,
          highlights,
          operationId,
          aspectMode: input.aspectMode,
        });
  if (cut.cancelled) throw new CancelledError();
  if (!cut.success) throw new Error(cut.error || 'Highlight cut failed.');
  const cutPath =
    'highlight' in cut
      ? cut.highlight?.videoPath
      : 'videoPath' in cut
        ? cut.videoPath
        : undefined;
  if (!cutPath || !cut.sourceRanges)
    throw new Error('The clip cutter did not return its verified timeline.');
  const clipSegments = rebaseClipSubtitles(segments, cut.sourceRanges);
  input.checkCancelled?.();
  const metadataResult = await SystemIPC.getVideoMetadata(cutPath);
  const meta = metadataResult.metadata;
  if (
    !metadataResult.success ||
    !meta?.duration ||
    !meta.width ||
    !meta.height
  ) {
    throw new Error(
      metadataResult.error || 'Cannot verify the cut video dimensions.'
    );
  }
  const spec = resolveSubtitleRenderSpec({
    displayMode: input.displayMode,
    stylePreset: input.style,
    typeface: input.typeface ?? useUIStore.getState().subtitleTypeface,
    baseFontSizePx: input.fontSize,
    videoWidthPx: meta.width,
    videoHeightPx: meta.height,
    displayWidthPx: meta.displayWidth ?? meta.width,
    displayHeightPx: meta.displayHeight ?? meta.height,
  });
  const captionOperationId = `${operationId}-captions`;
  useTaskStore.getState().setMerge({
    id: captionOperationId,
    inProgress: true,
    isCompleted: false,
    percent: 0,
    stage: 'Rendering clip subtitles',
  });
  input.onStage?.('rendering-subtitles');
  let outputPath: string;
  try {
    const rendered = await subtitleRendererClient.renderSubtitles({
      operationId: captionOperationId,
      srtContent: buildSrt({
        segments: clipSegments,
        mode: input.displayMode,
        noWrap: true,
      }),
      subtitleSegments: clipSegments,
      // Encoding can add a fractional tail frame. Keep shot coverage canonical.
      editorialCaptions: editorial
        ? {
            ...editorial,
            shots: editorial.shots.map((shot, i) =>
              i === editorial.shots.length - 1
                ? { ...shot, end: meta.duration }
                : shot
            ),
          }
        : undefined,
      outputDir: '',
      ...(input.outputPath
        ? { outputSavePath: input.outputPath }
        : { outputToLibrary: true }),
      videoDuration: meta.duration,
      videoWidth: meta.width,
      videoHeight: meta.height,
      displayWidth: meta.displayWidth ?? meta.width,
      displayHeight: meta.displayHeight ?? meta.height,
      frameRate: meta.frameRate,
      videoRotationDeg: meta.rotation ?? 0,
      originalVideoPath: cutPath,
      fontSizePx: spec.outputFontSizePx,
      stylePreset: input.style,
      outputMode: input.displayMode,
      subtitleRenderSpec: editorial
        ? undefined
        : serializeSubtitleRenderSpec(spec),
      overlayMode: 'overlayOnVideo',
    });
    if (rendered.cancelled) throw new CancelledError();
    if (!rendered.success || !rendered.outputPath)
      throw new Error(rendered.error || 'Clip subtitle render failed.');
    outputPath = rendered.outputPath;
  } finally {
    useTaskStore.getState().setMerge({ id: null, inProgress: false });
  }
  const translated = clipSegments.some(c => c.translation?.trim());
  const saved = await LibraryIPC.saveStoredSubtitleArtifact({
    content: buildSrt({
      segments: clipSegments,
      mode: translated ? 'dual' : 'original',
      noWrap: true,
    }),
    segments: clipSegments,
    kind: translated ? 'translation' : 'transcription',
    targetLanguage: translated ? input.targetLanguage : null,
    sourceVideoPath: outputPath,
    titleHint:
      highlights
        .map(h => h.title)
        .filter(Boolean)
        .join(' · ') || 'Highlight',
  });
  if (!saved.success || !saved.entry) {
    throw new Error(
      `Video rendered at ${outputPath}, but saving its reusable subtitles failed: ${saved.error || 'unknown error'}`
    );
  }
  const completion: HighlightRenderCompletion = {
    sourceVideoPath: videoPath,
    videoPath: outputPath,
    highlights: input.highlights,
    aspectMode: input.aspectMode,
    operationId,
    captionSignature: highlightCaptionSignature(
      input.segments,
      input.displayMode,
      input.style,
      input.fontSize,
      input.typeface ?? useUIStore.getState().subtitleTypeface
    ),
  };
  await rememberRenderedClip(sourceIdentity, completion);
  window.dispatchEvent(
    new CustomEvent(HIGHLIGHT_RENDER_COMPLETED, { detail: completion })
  );
  return {
    success: true as const,
    error: undefined as string | undefined,
    cancelled: false,
    operationId,
    videoPath: outputPath,
    sourceVideoPath: videoPath,
    sourceRanges: cut.sourceRanges,
    subtitlePath: saved.entry.filePath,
    subtitleEntryId: saved.entry.id,
    cueCount: clipSegments.length,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    displayMode: input.displayMode,
    subtitleRenderSpec: editorial
      ? undefined
      : serializeSubtitleRenderSpec(spec),
    captionTreatment: editorial ? 'editorial-phrases' : 'subtitle-preset',
    editorialPlan: editorial,
    stage5CreditsConsumed: 0,
    highlight:
      highlights.length === 1
        ? { ...highlights[0], videoPath: outputPath }
        : undefined,
  };
}

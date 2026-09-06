import type { HighlightEditorialPlan } from '@shared-types/app';
import {
  validateHighlightEditorialPlan,
  editorialSourceSignature,
} from '../../shared/helpers/highlight-editorial';
import { useSubStore } from '../state/subtitle-store';
import { useVideoStore } from '../state/video-store';
import { useUIStore } from '../state/ui-store';
import {
  findStoredTranscriptAnalysis,
  saveStoredTranscriptAnalysis,
} from '../ipc/transcript-analysis';
import {
  buildTranscriptHash,
  toUsableTranscriptSegments,
} from '../components/TranscriptSummaryPanel/transcript-usable-segments';
import { selectHighlightsByCue } from '../../shared/helpers/highlight-selection';

export const HIGHLIGHT_ANALYSIS_CHANGED =
  'translator-highlight-analysis-changed';

/** Human editing uses the same saved analysis and validation as MCP selection. */
export async function saveMountedHighlightEditorial(
  id: string,
  input: HighlightEditorialPlan | null,
  expectedSnapshotId: string
) {
  const context = await mountedHighlightContext();
  if (context.snapshotId !== expectedSnapshotId)
    throw new Error(
      'The video or captions changed. Reopen the edit before saving.'
    );
  const stored = await findStoredTranscriptAnalysis(context.lookup);
  if (!stored.success || !stored.analysis)
    throw new Error('The saved highlight is no longer available.');
  const selected = stored.analysis.highlights.find(h => h.id === id);
  if (!selected)
    throw new Error('The selected highlight is no longer available.');
  const editorial = input
    ? validateHighlightEditorialPlan(input, selected.end - selected.start)
    : undefined;
  const highlights = stored.analysis.highlights.map(h =>
    h.id === id
      ? {
          ...h,
          videoPath: undefined,
          editorial,
          editorialSourceSignature: editorial
            ? editorialSourceSignature(context.segments, h.start, h.end)
            : undefined,
        }
      : h
  );
  if ((await mountedHighlightContext()).snapshotId !== expectedSnapshotId)
    throw new Error('The source changed while saving the edit.');
  const saved = await saveStoredTranscriptAnalysis({
    ...context.lookup,
    summary: stored.analysis.summary,
    sections: stored.analysis.sections,
    highlights,
    highlightStatus: stored.analysis.highlightStatus,
  });
  if (!saved.success)
    throw new Error(saved.error || 'Cannot save the Short edit.');
  window.dispatchEvent(new Event(HIGHLIGHT_ANALYSIS_CHANGED));
}

export async function mountedHighlightContext() {
  const subtitles = useSubStore.getState();
  const video = useVideoStore.getState();
  const ui = useUIStore.getState();
  const segments = subtitles.order
    .map(id => subtitles.segments[id])
    .filter(Boolean);
  const videoPath =
    video.originalPath || video.path || subtitles.sourceVideoPath;
  if (!videoPath || !segments.length)
    throw new Error('Open a saved video with its transcript first.');
  if (subtitles.sourceVideoPath && subtitles.sourceVideoPath !== videoPath) {
    throw new Error(
      'The mounted transcript belongs to another video. Open the saved video and transcript together.'
    );
  }
  const transcriptHash = await buildTranscriptHash(
    toUsableTranscriptSegments(segments)
  );
  // Translation edits and source switches invalidate issued editing snapshots too.
  const snapshotBytes = new TextEncoder().encode(
    JSON.stringify({
      videoPath,
      sourceAsset: video.sourceAssetIdentity,
      sourceId: subtitles.sourceId,
      documentId: subtitles.documentId,
      language: ui.summaryLanguage,
      effort: ui.summaryEffortLevel,
      segments: segments.map(c => [
        c.id,
        c.start,
        c.end,
        c.original,
        c.translation,
      ]),
    })
  );
  const snapshotId = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', snapshotBytes))
  )
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const lookup = {
    transcriptHash,
    summaryLanguage: ui.summaryLanguage,
    effortLevel: ui.summaryEffortLevel,
    sourceVideoPath: videoPath,
    sourceUrl: video.sourceUrl || subtitles.sourceUrl,
    libraryEntryId: subtitles.libraryEntryId,
  };
  return {
    videoPath,
    segments,
    snapshotId,
    lookup,
    ui,
    targetLanguage: subtitles.targetLanguage || ui.targetLanguage,
  };
}

export async function getMountedHighlights() {
  const context = await mountedHighlightContext();
  const stored = await findStoredTranscriptAnalysis(context.lookup);
  if (!stored.success)
    throw new Error(stored.error || 'Cannot read saved highlights.');
  return {
    snapshot_id: context.snapshotId,
    source_video_path: context.videoPath,
    cue_count: context.segments.length,
    highlights: stored.analysis?.highlights || [],
    analysis_path: stored.entry?.filePath || null,
    guidance:
      'Read app_subtitles_get including surrounding context. Select complete ideas with an immediate hook and a resolved ending. Use stable cue IDs for both boundaries. Do not fill a quota or invent quotes. Then app_highlights_set and app_start_highlight_render. These steps consume no Stage5 credit.',
  };
}

export async function setMountedHighlights(input: {
  snapshotId: string;
  highlights: Array<{
    id: string;
    startCueId: string;
    endCueId: string;
    title: string;
    description?: string;
    reason?: string;
    editorial?: HighlightEditorialPlan;
  }>;
}) {
  const context = await mountedHighlightContext();
  if (input.snapshotId !== context.snapshotId)
    throw new Error(
      'The source or transcript changed. Read app_highlights_get again.'
    );
  const highlights = selectHighlightsByCue(context.segments, input.highlights);
  const stored = await findStoredTranscriptAnalysis(context.lookup);
  if (!stored.success)
    throw new Error(stored.error || 'Cannot read saved analysis.');
  if ((await mountedHighlightContext()).snapshotId !== context.snapshotId)
    throw new Error('The source changed while saving highlights.');
  const saved = await saveStoredTranscriptAnalysis({
    ...context.lookup,
    summary: stored.analysis?.summary || '',
    sections: stored.analysis?.sections || [],
    highlights,
    highlightStatus: 'complete',
  });
  if (!saved.success)
    throw new Error(saved.error || 'Cannot save selected highlights.');
  window.dispatchEvent(new Event(HIGHLIGHT_ANALYSIS_CHANGED));
  return {
    snapshot_id: context.snapshotId,
    highlights,
    analysis_path: saved.entry?.filePath,
    stage5_credits_consumed: 0,
  };
}

export async function resolveMountedHighlightRender(input: {
  snapshotId: string;
  highlightIds: string[];
}) {
  const context = await mountedHighlightContext();
  if (input.snapshotId !== context.snapshotId)
    throw new Error(
      'The source or transcript changed. Read app_highlights_get again.'
    );
  if (
    !Array.isArray(input.highlightIds) ||
    !input.highlightIds.length ||
    input.highlightIds.length > 20 ||
    new Set(input.highlightIds).size !== input.highlightIds.length
  ) {
    throw new Error(
      'Choose 1–20 distinct saved highlight IDs in playback order.'
    );
  }
  const stored = await findStoredTranscriptAnalysis(context.lookup);
  if (!stored.success)
    throw new Error(stored.error || 'Cannot read saved highlights.');
  const highlights = input.highlightIds.map(id => {
    const highlight = stored.analysis?.highlights.find(h => h.id === id);
    if (!highlight) throw new Error(`Saved highlight was not found: ${id}`);
    return highlight;
  });
  if ((await mountedHighlightContext()).snapshotId !== context.snapshotId)
    throw new Error('The source changed while preparing the clip.');
  return { ...context, highlights };
}

import type { SrtSegment } from '@shared-types/app';

type Selection = {
  jobId: string;
  revisionId: string;
  documentGeneration: number;
  fingerprint: string;
};
export let appliedSubtitleSelection: Selection | null = null;
export function setAppliedSubtitleSelection(selection: Selection | null): void {
  appliedSubtitleSelection = selection;
}
export function subtitleSelectionFingerprint(segments: SrtSegment[]): string {
  return JSON.stringify(
    segments.map(cue => [
      cue.id,
      cue.start,
      cue.end,
      cue.original,
      cue.translation || '',
      cue.sourceCueIds || [cue.id],
    ])
  );
}

/** A local SRT is independent. A mounted persistent job must export its selection. */
export function assertSelectedSubtitleRevisionUnchanged(document: {
  documentGeneration: number;
  order: string[];
  segments: Record<string, SrtSegment>;
}): void {
  if (
    appliedSubtitleSelection?.documentGeneration ===
      document.documentGeneration &&
    subtitleSelectionFingerprint(
      document.order.map(id => document.segments[id])
    ) !== appliedSubtitleSelection.fingerprint
  ) {
    throw new Error(
      'This job has subtitle edits that are not in its selected revision. Apply them with apply_subtitle_revision (use_app_subtitles=true) before exporting, or open the saved SRT as a separate document.'
    );
  }
}

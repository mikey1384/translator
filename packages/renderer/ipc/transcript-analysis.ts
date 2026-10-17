import type {
  StoredTranscriptAnalysisArtifact,
  StoredTranscriptAnalysisEntry,
  SummaryEffortLevel,
  TranscriptHighlight,
  TranscriptHighlightStatus,
  TranscriptSummarySection,
} from '@shared-types/app';

export function saveStoredTranscriptAnalysis(options: {
  transcriptHash: string;
  summaryLanguage: string;
  effortLevel: SummaryEffortLevel;
  summary: string;
  sections?: TranscriptSummarySection[] | null;
  highlights?: TranscriptHighlight[] | null;
  highlightStatus?: TranscriptHighlightStatus | null;
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
  libraryEntryId?: string | null;
}): Promise<{
  success: boolean;
  entry?: StoredTranscriptAnalysisEntry;
  error?: string;
}> {
  return window.electron.saveStoredTranscriptAnalysis(options);
}

export function findStoredTranscriptAnalysis(options: {
  transcriptHash: string;
  summaryLanguage: string;
  effortLevel: SummaryEffortLevel;
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
  libraryEntryId?: string | null;
  allowOtherVariant?: boolean;
  allowOtherTranscript?: boolean;
}): Promise<{
  success: boolean;
  entry?: StoredTranscriptAnalysisEntry | null;
  analysis?: StoredTranscriptAnalysisArtifact;
  /** The analysis was made from an earlier version of the subtitles. */
  transcriptChanged?: boolean;
  error?: string;
}> {
  return window.electron.findStoredTranscriptAnalysis(options);
}

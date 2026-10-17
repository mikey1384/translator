import type { SummaryEffortLevel } from '@shared-types/app';

// Pure lookup ranking, kept apart from the Electron-bound library so it can
// be tested directly.

export interface StoredTranscriptAnalysisEntry {
  id: string;
  transcriptHash: string;
  summaryLanguage: string;
  effortLevel: SummaryEffortLevel;
  filePath: string;
  sourceVideoPaths: string[];
  sourceUrls: string[];
  libraryEntryIds: string[];
  createdAt: string;
  updatedAt: string;
}

function entryPreferenceScore(
  entry: StoredTranscriptAnalysisEntry,
  preferred: {
    sourceVideoPath: string;
    sourceUrl: string;
    libraryEntryId: string;
  }
): number {
  let score = 0;
  if (
    preferred.libraryEntryId &&
    entry.libraryEntryIds.includes(preferred.libraryEntryId)
  ) {
    score += 4;
  }
  if (preferred.sourceUrl && entry.sourceUrls.includes(preferred.sourceUrl)) {
    score += 2;
  }
  if (
    preferred.sourceVideoPath &&
    entry.sourceVideoPaths.includes(preferred.sourceVideoPath)
  ) {
    score += 1;
  }
  return score;
}

export type AnalysisLookup = {
  transcriptHash: string;
  summaryLanguage: string;
  effortLevel: SummaryEffortLevel;
  sourceVideoPath: string;
  sourceUrl: string;
  libraryEntryId: string;
  allowOtherVariant: boolean;
  allowOtherTranscript: boolean;
};

/**
 * Saved analyses worth trying for a lookup, best first:
 * 1. this transcript in this language and quality;
 * 2. this transcript in another language or quality (allowOtherVariant);
 * 3. an older transcript of the same video (allowOtherTranscript), newest
 *    first, so fixing one word in a cue never hides a paid summary or its
 *    highlights. Each highlight carries a signature of its own cues, so the
 *    caller can tell which ones the edit touched.
 */
export function rankStoredAnalysisCandidates(
  entries: readonly StoredTranscriptAnalysisEntry[],
  lookup: AnalysisLookup
): StoredTranscriptAnalysisEntry[] {
  const preferred = {
    sourceVideoPath: lookup.sourceVideoPath,
    sourceUrl: lookup.sourceUrl,
    libraryEntryId: lookup.libraryEntryId,
  };
  const isExactVariant = (entry: StoredTranscriptAnalysisEntry) =>
    entry.summaryLanguage === lookup.summaryLanguage &&
    entry.effortLevel === lookup.effortLevel;
  const exact: StoredTranscriptAnalysisEntry[] = [];
  const otherVariant: StoredTranscriptAnalysisEntry[] = [];
  const otherTranscript: StoredTranscriptAnalysisEntry[] = [];

  for (const entry of entries) {
    const variantMatches = isExactVariant(entry);
    if (!variantMatches && !lookup.allowOtherVariant) continue;
    if (entry.transcriptHash === lookup.transcriptHash) {
      (variantMatches ? exact : otherVariant).push(entry);
      continue;
    }
    if (
      lookup.allowOtherTranscript &&
      entryPreferenceScore(entry, preferred) > 0
    ) {
      otherTranscript.push(entry);
    }
  }

  const byPreferenceThenNewest = (
    a: StoredTranscriptAnalysisEntry,
    b: StoredTranscriptAnalysisEntry
  ) => {
    const scoreDiff =
      entryPreferenceScore(b, preferred) - entryPreferenceScore(a, preferred);
    if (scoreDiff !== 0) return scoreDiff;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  };
  exact.sort(byPreferenceThenNewest);
  otherVariant.sort(byPreferenceThenNewest);
  otherTranscript.sort((a, b) => {
    const variantDiff = Number(isExactVariant(b)) - Number(isExactVariant(a));
    if (variantDiff !== 0) return variantDiff;
    const languageDiff =
      Number(b.summaryLanguage === lookup.summaryLanguage) -
      Number(a.summaryLanguage === lookup.summaryLanguage);
    if (languageDiff !== 0) return languageDiff;
    const timeDiff = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (timeDiff !== 0) return timeDiff;
    return (
      entryPreferenceScore(b, preferred) - entryPreferenceScore(a, preferred)
    );
  });

  return [...exact, ...otherVariant, ...otherTranscript];
}

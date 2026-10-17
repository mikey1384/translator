import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankStoredAnalysisCandidates,
  type StoredTranscriptAnalysisEntry,
} from '../services/transcript-analysis-ranking.js';

function entry(
  id: string,
  overrides: Partial<StoredTranscriptAnalysisEntry>
): StoredTranscriptAnalysisEntry {
  return {
    id,
    transcriptHash: 'hash-a',
    summaryLanguage: 'english',
    effortLevel: 'standard',
    filePath: `/tmp/${id}.json`,
    sourceVideoPaths: ['/videos/talk.mp4'],
    sourceUrls: [],
    libraryEntryIds: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const lookup = {
  transcriptHash: 'hash-b',
  summaryLanguage: 'english',
  effortLevel: 'standard' as const,
  sourceVideoPath: '/videos/talk.mp4',
  sourceUrl: '',
  libraryEntryId: '',
  allowOtherVariant: true,
  allowOtherTranscript: true,
};

test('an edited transcript falls back to the newest analysis of the same video', () => {
  const ranked = rankStoredAnalysisCandidates(
    [
      entry('old', { updatedAt: '2026-10-01T00:00:00.000Z' }),
      entry('newer', { updatedAt: '2026-10-05T00:00:00.000Z' }),
      entry('other-video', {
        sourceVideoPaths: ['/videos/other.mp4'],
        updatedAt: '2026-10-09T00:00:00.000Z',
      }),
    ],
    lookup
  );
  assert.deepEqual(
    ranked.map(e => e.id),
    ['newer', 'old']
  );
});

test('an exact transcript match still wins over older versions', () => {
  const ranked = rankStoredAnalysisCandidates(
    [
      entry('older-version', { updatedAt: '2026-10-09T00:00:00.000Z' }),
      entry('exact', { transcriptHash: 'hash-b' }),
      entry('exact-korean', {
        transcriptHash: 'hash-b',
        summaryLanguage: 'korean',
      }),
    ],
    lookup
  );
  assert.deepEqual(
    ranked.map(e => e.id),
    ['exact', 'exact-korean', 'older-version']
  );
});

test('older versions prefer the requested language, and stay off unless asked', () => {
  const entries = [
    entry('korean', {
      summaryLanguage: 'korean',
      updatedAt: '2026-10-09T00:00:00.000Z',
    }),
    entry('english', { updatedAt: '2026-10-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(
    rankStoredAnalysisCandidates(entries, lookup).map(e => e.id),
    ['english', 'korean']
  );
  assert.deepEqual(
    rankStoredAnalysisCandidates(entries, {
      ...lookup,
      allowOtherTranscript: false,
    }),
    []
  );
});

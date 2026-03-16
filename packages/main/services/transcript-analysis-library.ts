import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  SummaryEffortLevel,
  TranscriptHighlight,
  TranscriptHighlightStatus,
  TranscriptSummarySection,
} from '@shared-types/app';
import { normalizeYoutubeWatchUrl } from './video-suggestions/shared.js';

export interface StoredTranscriptAnalysisArtifact {
  summary: string;
  sections: TranscriptSummarySection[];
  highlights: TranscriptHighlight[];
  highlightStatus: TranscriptHighlightStatus;
}

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

interface StoredTranscriptAnalysisIndex {
  version: 1;
  entries: StoredTranscriptAnalysisEntry[];
}

interface SaveStoredTranscriptAnalysisArgs {
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
}

interface FindStoredTranscriptAnalysisArgs {
  transcriptHash: string;
  summaryLanguage: string;
  effortLevel: SummaryEffortLevel;
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
  libraryEntryId?: string | null;
}

const INDEX_VERSION = 1 as const;
const LIBRARY_DIR_NAME = 'transcript-analysis-history';
const ENTRIES_DIR_NAME = 'entries';
const INDEX_FILE_NAME = 'index.json';

function getLibraryRootDir(): string {
  return path.join(app.getPath('userData'), LIBRARY_DIR_NAME);
}

function getEntriesDir(): string {
  return path.join(getLibraryRootDir(), ENTRIES_DIR_NAME);
}

function getIndexPath(): string {
  return path.join(getLibraryRootDir(), INDEX_FILE_NAME);
}

function normalizeVideoPath(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function normalizeSourceUrl(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const normalizedYoutube = normalizeYoutubeWatchUrl(raw);
  if (normalizedYoutube) {
    return normalizedYoutube;
  }

  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const port = parsed.port ? `:${parsed.port}` : '';
    const pathname =
      parsed.pathname === '/'
        ? '/'
        : parsed.pathname.replace(/\/+$/g, '') || '/';
    return `${protocol}//${host}${port}${pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}

function normalizeSummaryLanguage(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeTranscriptHash(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeLibraryEntryId(value: string | null | undefined): string {
  return String(value || '').trim();
}

function normalizeEffortLevel(value: unknown): SummaryEffortLevel {
  return value === 'high' ? 'high' : 'standard';
}

function normalizeHighlightStatus(value: unknown): TranscriptHighlightStatus {
  if (value === 'degraded') return 'degraded';
  if (value === 'not_requested') return 'not_requested';
  return 'complete';
}

function normalizeLineNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) {
      return Math.max(1, Math.floor(numeric));
    }
  }
  return undefined;
}

function sanitizeSection(input: unknown, fallbackIndex: number) {
  const raw = input && typeof input === 'object' ? (input as any) : null;
  if (!raw) return null;
  const title = String(raw.title || '').trim();
  const content = String(raw.content || '').trim();
  const index =
    typeof raw.index === 'number' && Number.isFinite(raw.index)
      ? Math.max(1, Math.floor(raw.index))
      : fallbackIndex;
  if (!title && !content) return null;
  return { index, title, content } as TranscriptSummarySection;
}

function sanitizeSections(input: unknown): TranscriptSummarySection[] {
  if (!Array.isArray(input)) return [];
  const sections: TranscriptSummarySection[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const section = sanitizeSection(input[i], i + 1);
    if (section) sections.push(section);
  }
  return sections;
}

function sanitizeHighlight(input: unknown): TranscriptHighlight | null {
  const raw = input && typeof input === 'object' ? (input as any) : null;
  if (!raw) return null;

  const start =
    typeof raw.start === 'number' && Number.isFinite(raw.start)
      ? raw.start
      : NaN;
  const end =
    typeof raw.end === 'number' && Number.isFinite(raw.end) ? raw.end : NaN;

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }

  const id = String(raw.id || '').trim();
  const title =
    typeof raw.title === 'string' && raw.title.trim().length > 0
      ? raw.title
      : undefined;
  const description =
    typeof raw.description === 'string' && raw.description.trim().length > 0
      ? raw.description
      : undefined;
  const score =
    typeof raw.score === 'number' && Number.isFinite(raw.score)
      ? raw.score
      : undefined;
  const confidence =
    typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
      ? raw.confidence
      : undefined;
  const category =
    typeof raw.category === 'string' && raw.category.trim().length > 0
      ? raw.category
      : undefined;
  const justification =
    typeof raw.justification === 'string' && raw.justification.trim().length > 0
      ? raw.justification
      : undefined;
  const lineStart = normalizeLineNumber(raw.lineStart);
  const lineEnd = normalizeLineNumber(raw.lineEnd);

  return {
    id: id || undefined,
    start,
    end,
    title,
    description,
    score,
    confidence,
    category,
    justification,
    lineStart,
    lineEnd,
  };
}

function sanitizeHighlights(input: unknown): TranscriptHighlight[] {
  if (!Array.isArray(input)) return [];
  const highlights: TranscriptHighlight[] = [];
  for (const candidate of input) {
    const sanitized = sanitizeHighlight(candidate);
    if (sanitized) highlights.push(sanitized);
  }
  return highlights;
}

function sanitizeArtifact(input: unknown): StoredTranscriptAnalysisArtifact {
  const raw = input && typeof input === 'object' ? (input as any) : null;
  const summary = String(raw?.summary || '').trim();
  const sections = sanitizeSections(raw?.sections);
  const highlights = sanitizeHighlights(raw?.highlights);
  const highlightStatus = normalizeHighlightStatus(raw?.highlightStatus);
  return { summary, sections, highlights, highlightStatus };
}

function sanitizeEntry(input: unknown): StoredTranscriptAnalysisEntry | null {
  const raw = input && typeof input === 'object' ? (input as any) : null;
  if (!raw) return null;

  const id = String(raw.id || '').trim();
  const transcriptHash = normalizeTranscriptHash(raw.transcriptHash);
  const summaryLanguage = normalizeSummaryLanguage(raw.summaryLanguage);
  const effortLevel = normalizeEffortLevel(raw.effortLevel);
  const filePath = String(raw.filePath || '').trim();

  if (!id || !transcriptHash || !summaryLanguage || !filePath) return null;

  const sourceVideoPaths = Array.isArray(raw.sourceVideoPaths)
    ? raw.sourceVideoPaths
        .map((value: unknown) => normalizeVideoPath(String(value || '')))
        .filter(Boolean)
    : [];
  const sourceUrls = Array.isArray(raw.sourceUrls)
    ? raw.sourceUrls
        .map((value: unknown) => normalizeSourceUrl(String(value || '')))
        .filter(Boolean)
    : [];
  const libraryEntryIds = Array.isArray(raw.libraryEntryIds)
    ? raw.libraryEntryIds
        .map((value: unknown) => normalizeLibraryEntryId(String(value || '')))
        .filter(Boolean)
    : [];

  const createdAt =
    String(raw.createdAt || '').trim() || new Date().toISOString();
  const updatedAt =
    String(raw.updatedAt || '').trim() || new Date().toISOString();

  return {
    id,
    transcriptHash,
    summaryLanguage,
    effortLevel,
    filePath,
    sourceVideoPaths: Array.from(new Set(sourceVideoPaths)),
    sourceUrls: Array.from(new Set(sourceUrls)),
    libraryEntryIds: Array.from(new Set(libraryEntryIds)),
    createdAt,
    updatedAt,
  };
}

function createEmptyIndex(): StoredTranscriptAnalysisIndex {
  return { version: INDEX_VERSION, entries: [] };
}

async function ensureLibraryDirs(): Promise<void> {
  await fs.mkdir(getEntriesDir(), { recursive: true });
}

async function readIndex(): Promise<StoredTranscriptAnalysisIndex> {
  await ensureLibraryDirs();
  try {
    const raw = await fs.readFile(getIndexPath(), 'utf8');
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      entries?: unknown;
    };
    const entries = Array.isArray(parsed?.entries)
      ? parsed.entries
          .map(entry => sanitizeEntry(entry))
          .filter((entry): entry is StoredTranscriptAnalysisEntry =>
            Boolean(entry)
          )
      : [];
    return { version: INDEX_VERSION, entries };
  } catch {
    return createEmptyIndex();
  }
}

async function writeIndex(index: StoredTranscriptAnalysisIndex): Promise<void> {
  await ensureLibraryDirs();
  await fs.writeFile(getIndexPath(), JSON.stringify(index, null, 2) + '\n');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildEntryFilePath(entry: StoredTranscriptAnalysisEntry): string {
  const lang = entry.summaryLanguage.replace(/[^a-z0-9_-]/g, '') || 'lang';
  const effort = entry.effortLevel === 'high' ? 'high' : 'standard';
  return path.join(
    getEntriesDir(),
    `analysis-${lang}-${effort}-${entry.id}.json`
  );
}

function mergeAlias(values: string[], nextValue: string): string[] {
  if (!nextValue) return values;
  if (values.includes(nextValue)) return values;
  return [...values, nextValue];
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

export async function saveStoredTranscriptAnalysis(
  args: SaveStoredTranscriptAnalysisArgs
): Promise<StoredTranscriptAnalysisEntry> {
  const transcriptHash = normalizeTranscriptHash(args.transcriptHash);
  const summaryLanguage = normalizeSummaryLanguage(args.summaryLanguage);
  const effortLevel = normalizeEffortLevel(args.effortLevel);
  const sourceVideoPath = normalizeVideoPath(args.sourceVideoPath);
  const sourceUrl = normalizeSourceUrl(args.sourceUrl);
  const libraryEntryId = normalizeLibraryEntryId(args.libraryEntryId);
  const artifact = sanitizeArtifact({
    summary: args.summary,
    sections: args.sections,
    highlights: args.highlights,
    highlightStatus: args.highlightStatus,
  });

  if (!transcriptHash) {
    throw new Error(
      'Cannot store transcript analysis without transcript hash.'
    );
  }
  if (!summaryLanguage) {
    throw new Error(
      'Cannot store transcript analysis without summary language.'
    );
  }
  if (
    !artifact.summary &&
    artifact.sections.length === 0 &&
    artifact.highlights.length === 0
  ) {
    throw new Error('Cannot store empty transcript analysis.');
  }

  const index = await readIndex();
  const now = new Date().toISOString();

  let entry =
    index.entries.find(
      candidate =>
        candidate.transcriptHash === transcriptHash &&
        candidate.summaryLanguage === summaryLanguage &&
        candidate.effortLevel === effortLevel
    ) ?? null;

  if (!entry) {
    entry = {
      id: crypto.randomUUID(),
      transcriptHash,
      summaryLanguage,
      effortLevel,
      filePath: '',
      sourceVideoPaths: [],
      sourceUrls: [],
      libraryEntryIds: [],
      createdAt: now,
      updatedAt: now,
    };
    index.entries.unshift(entry);
  }

  entry.sourceVideoPaths = mergeAlias(entry.sourceVideoPaths, sourceVideoPath);
  entry.sourceUrls = mergeAlias(entry.sourceUrls, sourceUrl);
  entry.libraryEntryIds = mergeAlias(entry.libraryEntryIds, libraryEntryId);
  entry.updatedAt = now;

  if (!entry.filePath) {
    entry.filePath = buildEntryFilePath(entry);
  }

  await ensureLibraryDirs();
  await fs.writeFile(entry.filePath, JSON.stringify(artifact, null, 2) + '\n');
  await writeIndex(index);

  return entry;
}

export async function findStoredTranscriptAnalysis(
  args: FindStoredTranscriptAnalysisArgs
): Promise<{
  entry: StoredTranscriptAnalysisEntry | null;
  analysis?: StoredTranscriptAnalysisArtifact;
}> {
  const transcriptHash = normalizeTranscriptHash(args.transcriptHash);
  const summaryLanguage = normalizeSummaryLanguage(args.summaryLanguage);
  const effortLevel = normalizeEffortLevel(args.effortLevel);
  const sourceVideoPath = normalizeVideoPath(args.sourceVideoPath);
  const sourceUrl = normalizeSourceUrl(args.sourceUrl);
  const libraryEntryId = normalizeLibraryEntryId(args.libraryEntryId);

  if (!transcriptHash || !summaryLanguage) {
    return { entry: null };
  }

  const index = await readIndex();
  const availableEntries: StoredTranscriptAnalysisEntry[] = [];
  let pruned = false;

  for (const entry of index.entries) {
    if (
      entry.transcriptHash !== transcriptHash ||
      entry.summaryLanguage !== summaryLanguage ||
      entry.effortLevel !== effortLevel
    ) {
      continue;
    }
    if (!(await fileExists(entry.filePath))) {
      pruned = true;
      continue;
    }
    availableEntries.push(entry);
  }

  if (pruned) {
    const availableIds = new Set(availableEntries.map(entry => entry.id));
    index.entries = index.entries.filter(
      entry =>
        entry.transcriptHash !== transcriptHash ||
        entry.summaryLanguage !== summaryLanguage ||
        entry.effortLevel !== effortLevel ||
        availableIds.has(entry.id)
    );
    await writeIndex(index);
  }

  if (availableEntries.length === 0) {
    return { entry: null };
  }

  availableEntries.sort((a, b) => {
    const scoreDiff =
      entryPreferenceScore(b, { sourceVideoPath, sourceUrl, libraryEntryId }) -
      entryPreferenceScore(a, { sourceVideoPath, sourceUrl, libraryEntryId });
    if (scoreDiff !== 0) return scoreDiff;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });

  for (const candidate of availableEntries) {
    try {
      const raw = await fs.readFile(candidate.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const analysis = sanitizeArtifact(parsed);
      if (
        !analysis.summary &&
        analysis.sections.length === 0 &&
        analysis.highlights.length === 0
      ) {
        continue;
      }
      return { entry: candidate, analysis };
    } catch {
      continue;
    }
  }

  return { entry: null };
}

import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeYoutubeWatchUrl } from './video-suggestions/shared.js';

export type StoredSubtitleKind = 'transcription' | 'translation';

export interface StoredSubtitleEntry {
  id: string;
  kind: StoredSubtitleKind;
  targetLanguage: string | null;
  filePath: string;
  sourceVideoPaths: string[];
  sourceUrls: string[];
  createdAt: string;
  updatedAt: string;
}

interface StoredSubtitleIndex {
  version: 1;
  entries: StoredSubtitleEntry[];
}

interface SaveStoredSubtitleArgs {
  content: string;
  kind: StoredSubtitleKind;
  targetLanguage?: string | null;
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
  titleHint?: string | null;
}

interface FindStoredSubtitleArgs {
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
  targetLanguage?: string | null;
}

const INDEX_VERSION = 1 as const;
const LIBRARY_DIR_NAME = 'subtitle-history';
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

function normalizeTargetLanguage(value: string | null | undefined): string | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized || null;
}

function sanitizeEntry(input: unknown): StoredSubtitleEntry | null {
  const raw = input && typeof input === 'object' ? (input as any) : null;
  if (!raw) return null;
  const id = String(raw.id || '').trim();
  const kind =
    raw.kind === 'translation' || raw.kind === 'transcription'
      ? raw.kind
      : null;
  const filePath = String(raw.filePath || '').trim();
  if (!id || !kind || !filePath) return null;
  const targetLanguage = normalizeTargetLanguage(raw.targetLanguage);

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
  const createdAt =
    String(raw.createdAt || '').trim() || new Date().toISOString();
  const updatedAt =
    String(raw.updatedAt || '').trim() || new Date().toISOString();

  return {
    id,
    kind,
    targetLanguage,
    filePath,
    sourceVideoPaths: Array.from(new Set(sourceVideoPaths)),
    sourceUrls: Array.from(new Set(sourceUrls)),
    createdAt,
    updatedAt,
  };
}

function createEmptyIndex(): StoredSubtitleIndex {
  return {
    version: INDEX_VERSION,
    entries: [],
  };
}

async function ensureLibraryDirs(): Promise<void> {
  await fs.mkdir(getEntriesDir(), { recursive: true });
}

async function readIndex(): Promise<StoredSubtitleIndex> {
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
          .filter((entry): entry is StoredSubtitleEntry => Boolean(entry))
      : [];
    return {
      version: INDEX_VERSION,
      entries,
    };
  } catch {
    return createEmptyIndex();
  }
}

async function writeIndex(index: StoredSubtitleIndex): Promise<void> {
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

function slugifyTitleHint(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return 'subtitles';
  return (
    raw
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'subtitles'
  );
}

function buildEntryFilePath(entry: StoredSubtitleEntry, titleHint?: string | null) {
  const baseName = slugifyTitleHint(titleHint);
  const languageSuffix =
    entry.kind === 'translation' && entry.targetLanguage
      ? `-${entry.targetLanguage.replace(/[^a-z0-9_-]/g, '')}`
      : '';
  return path.join(
    getEntriesDir(),
    `${baseName}-${entry.kind}${languageSuffix}-${entry.id}.srt`
  );
}

function mergeAliases(values: string[], nextValue: string): string[] {
  if (!nextValue) return values;
  if (values.includes(nextValue)) return values;
  return [...values, nextValue];
}

function entryMatchesSource(
  entry: StoredSubtitleEntry,
  sourceVideoPath: string,
  sourceUrl: string
): boolean {
  return Boolean(
    (sourceUrl && entry.sourceUrls.includes(sourceUrl)) ||
      (sourceVideoPath && entry.sourceVideoPaths.includes(sourceVideoPath))
  );
}

export async function saveStoredSubtitleArtifact(
  args: SaveStoredSubtitleArgs
): Promise<StoredSubtitleEntry> {
  const content = String(args.content || '').trim();
  if (!content) {
    throw new Error('Cannot store empty subtitle content.');
  }

  const normalizedVideoPath = normalizeVideoPath(args.sourceVideoPath);
  const normalizedSourceUrl = normalizeSourceUrl(args.sourceUrl);
  const normalizedTargetLanguage =
    args.kind === 'translation'
      ? normalizeTargetLanguage(args.targetLanguage)
      : null;
  if (!normalizedVideoPath && !normalizedSourceUrl) {
    throw new Error('Cannot store subtitle history without a source identifier.');
  }
  const index = await readIndex();
  const now = new Date().toISOString();

  let entry =
    index.entries.find(
      candidate =>
        candidate.kind === args.kind &&
        (args.kind !== 'translation' ||
          candidate.targetLanguage === normalizedTargetLanguage) &&
        entryMatchesSource(
          candidate,
          normalizedVideoPath,
          normalizedSourceUrl
        )
    ) ?? null;

  if (!entry) {
    entry = {
      id: crypto.randomUUID(),
      kind: args.kind,
      targetLanguage: normalizedTargetLanguage,
      filePath: '',
      sourceVideoPaths: [],
      sourceUrls: [],
      createdAt: now,
      updatedAt: now,
    };
    index.entries.unshift(entry);
  }

  entry.targetLanguage = normalizedTargetLanguage;
  entry.sourceVideoPaths = mergeAliases(
    entry.sourceVideoPaths,
    normalizedVideoPath
  );
  entry.sourceUrls = mergeAliases(entry.sourceUrls, normalizedSourceUrl);
  entry.updatedAt = now;
  if (!entry.filePath) {
    entry.filePath = buildEntryFilePath(entry, args.titleHint);
  }

  await ensureLibraryDirs();
  await fs.writeFile(entry.filePath, content, 'utf8');
  await writeIndex(index);
  return entry;
}

export async function findStoredSubtitleForVideo(
  args: FindStoredSubtitleArgs
): Promise<{ entry: StoredSubtitleEntry | null; content?: string }> {
  const normalizedVideoPath = normalizeVideoPath(args.sourceVideoPath);
  const normalizedSourceUrl = normalizeSourceUrl(args.sourceUrl);
  const normalizedTargetLanguage = normalizeTargetLanguage(args.targetLanguage);
  if (!normalizedVideoPath && !normalizedSourceUrl) {
    return { entry: null };
  }

  const index = await readIndex();
  const availableEntries: StoredSubtitleEntry[] = [];
  let pruned = false;

  for (const entry of index.entries) {
    if (
      !entryMatchesSource(entry, normalizedVideoPath, normalizedSourceUrl)
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
    index.entries = index.entries.filter(
      entry => !entryMatchesSource(entry, normalizedVideoPath, normalizedSourceUrl)
        || availableEntries.some(candidate => candidate.id === entry.id)
    );
    await writeIndex(index);
  }

  const compatibleEntries = normalizedTargetLanguage
    ? availableEntries.filter(
        entry =>
          entry.kind !== 'translation' ||
          entry.targetLanguage === normalizedTargetLanguage
      )
    : availableEntries;

  if (compatibleEntries.length === 0) {
    return { entry: null };
  }

  compatibleEntries.sort((a, b) => {
    const rankEntry = (entry: StoredSubtitleEntry): number => {
      if (
        entry.kind === 'translation' &&
        entry.targetLanguage &&
        normalizedTargetLanguage &&
        entry.targetLanguage === normalizedTargetLanguage
      ) {
        return 0;
      }
      if (entry.kind === 'transcription') {
        return 1;
      }
      if (entry.kind === 'translation') {
        return 2;
      }
      return 3;
    };
    const rankDiff = rankEntry(a) - rankEntry(b);
    if (rankDiff !== 0) return rankDiff;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });

  const winner = compatibleEntries[0];
  const content = await fs.readFile(winner.filePath, 'utf8');
  return { entry: winner, content };
}

export async function syncStoredSubtitleVideoPath(args: {
  previousPath: string;
  savedPath: string;
}): Promise<boolean> {
  const previousPath = normalizeVideoPath(args.previousPath);
  const savedPath = normalizeVideoPath(args.savedPath);
  if (!previousPath || !savedPath) return false;

  const index = await readIndex();
  let changed = false;

  for (const entry of index.entries) {
    if (!entry.sourceVideoPaths.includes(previousPath)) {
      continue;
    }
    entry.sourceVideoPaths = mergeAliases(entry.sourceVideoPaths, savedPath);
    changed = true;
  }

  if (!changed) return false;
  await writeIndex(index);
  return true;
}

export async function rememberStoredSubtitleVideoPath(args: {
  entryId: string;
  sourceVideoPath: string;
}): Promise<boolean> {
  const entryId = String(args.entryId || '').trim();
  const sourceVideoPath = normalizeVideoPath(args.sourceVideoPath);
  if (!entryId || !sourceVideoPath) return false;

  const index = await readIndex();
  const entry = index.entries.find(candidate => candidate.id === entryId) ?? null;
  if (!entry) return false;
  if (entry.sourceVideoPaths.includes(sourceVideoPath)) return false;

  entry.sourceVideoPaths = mergeAliases(entry.sourceVideoPaths, sourceVideoPath);
  entry.updatedAt = new Date().toISOString();
  await writeIndex(index);
  return true;
}

export async function deleteStoredSubtitleEntry(
  entryId: string
): Promise<boolean> {
  const id = String(entryId || '').trim();
  if (!id) return false;

  const index = await readIndex();
  const nextEntries: StoredSubtitleEntry[] = [];
  let removed: StoredSubtitleEntry | null = null;

  for (const entry of index.entries) {
    if (entry.id === id) {
      removed = entry;
      continue;
    }
    nextEntries.push(entry);
  }

  if (!removed) return false;

  index.entries = nextEntries;
  await writeIndex(index);
  try {
    await fs.rm(removed.filePath, { force: true });
  } catch {
    // Ignore cleanup failures after index update.
  }
  return true;
}

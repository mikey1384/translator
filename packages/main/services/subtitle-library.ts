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
  sourceVideoAssetIdentities: string[];
  sourceUrls: string[];
  createdAt: string;
  updatedAt: string;
}

interface StoredSubtitleIndex {
  version: 2;
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

const INDEX_VERSION = 2 as const;
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

function normalizeSourceAssetIdentity(
  value: string | null | undefined
): string {
  return String(value || '').trim();
}

function normalizeTargetLanguage(
  value: string | null | undefined
): string | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized || null;
}

type StoredSourceStats = Awaited<ReturnType<typeof fs.stat>>;

function buildStoredSourceAssetIdentity(stats: StoredSourceStats): string {
  const sizeBytes = Number.isFinite(stats.size) ? stats.size : 0;
  const mtimeMs = Number.isFinite(stats.mtimeMs)
    ? Math.round(stats.mtimeMs)
    : 0;
  const birthtimeMs = Number.isFinite(stats.birthtimeMs)
    ? Math.round(stats.birthtimeMs)
    : 0;
  const dev = Number.isFinite(Number((stats as any).dev))
    ? Number((stats as any).dev)
    : 0;
  const ino = Number.isFinite(Number((stats as any).ino))
    ? Number((stats as any).ino)
    : 0;
  return `file:${dev}:${ino}:${sizeBytes}:${mtimeMs}:${birthtimeMs}`;
}

async function statStoredSourcePath(
  filePath: string
): Promise<StoredSourceStats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function selectStoredSourcePathSegment(
  entries: string[],
  segment: string
): string | null {
  const exactMatch = entries.find(entry => entry === segment);
  if (exactMatch) return exactMatch;

  const foldedSegment = segment.toLowerCase();
  const caseInsensitiveMatches = entries.filter(
    entry => entry.toLowerCase() === foldedSegment
  );
  if (caseInsensitiveMatches.length !== 1) {
    return null;
  }
  return caseInsensitiveMatches[0];
}

async function resolveStoredSourcePathForStat(
  value: string | null | undefined
): Promise<string | null> {
  const rawPath = String(value || '').trim();
  if (!rawPath) return null;

  const normalizedPath = path.normalize(rawPath);
  if (!normalizedPath) return null;

  if (await statStoredSourcePath(normalizedPath)) {
    return normalizedPath;
  }

  if (!path.isAbsolute(normalizedPath)) {
    return null;
  }

  const { root } = path.parse(normalizedPath);
  if (!root) {
    return null;
  }

  const segments = normalizedPath
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean);
  let currentPath = root;

  for (const segment of segments) {
    let directoryEntries: string[];
    try {
      directoryEntries = await fs.readdir(currentPath);
    } catch {
      return null;
    }

    const matchedSegment = selectStoredSourcePathSegment(
      directoryEntries,
      segment
    );
    if (!matchedSegment) {
      return null;
    }
    currentPath = path.join(currentPath, matchedSegment);
  }

  return currentPath;
}

async function resolveStoredSourceAssetIdentity(
  value: string | null | undefined
): Promise<string> {
  const resolvedPath = await resolveStoredSourcePathForStat(value);
  if (!resolvedPath) return '';

  const stats = await statStoredSourcePath(resolvedPath);
  if (!stats) {
    return '';
  }

  return buildStoredSourceAssetIdentity(stats);
}

async function collectStoredSourceAssetIdentities(
  sourceVideoPaths: string[]
): Promise<string[]> {
  const identities: string[] = [];

  for (const sourceVideoPath of sourceVideoPaths) {
    const identity = normalizeSourceAssetIdentity(
      await resolveStoredSourceAssetIdentity(sourceVideoPath)
    );
    if (!identity || identities.includes(identity)) {
      continue;
    }
    identities.push(identity);
  }

  return identities;
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
  const sourceVideoAssetIdentities = Array.isArray(
    raw.sourceVideoAssetIdentities
  )
    ? raw.sourceVideoAssetIdentities
        .map((value: unknown) =>
          normalizeSourceAssetIdentity(String(value || ''))
        )
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
    sourceVideoAssetIdentities: Array.from(new Set(sourceVideoAssetIdentities)),
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

function buildEntryFilePath(
  entry: StoredSubtitleEntry,
  titleHint?: string | null
) {
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

type SourceMatch = {
  bySourceUrl: boolean;
  bySourceVideoPath: boolean;
  bySourceVideoAssetIdentity: boolean;
};

function getSourceMatch(
  entry: StoredSubtitleEntry,
  sourceVideoPath: string,
  sourceUrl: string,
  sourceVideoAssetIdentity: string
): SourceMatch {
  return {
    bySourceUrl: Boolean(sourceUrl && entry.sourceUrls.includes(sourceUrl)),
    bySourceVideoPath: Boolean(
      sourceVideoPath && entry.sourceVideoPaths.includes(sourceVideoPath)
    ),
    bySourceVideoAssetIdentity: Boolean(
      sourceVideoAssetIdentity &&
      entry.sourceVideoAssetIdentities.includes(sourceVideoAssetIdentity)
    ),
  };
}

function getSaveSourceBucket(
  entry: StoredSubtitleEntry,
  match: SourceMatch
): number | null {
  if (match.bySourceUrl) return 0;
  if (match.bySourceVideoAssetIdentity) return 1;
  if (
    match.bySourceVideoPath &&
    entry.sourceVideoAssetIdentities.length === 0
  ) {
    return 2;
  }
  return null;
}

function getFindSourceBucket(
  entry: StoredSubtitleEntry,
  match: SourceMatch,
  requestedSourceVideoAssetIdentity: string
): number | null {
  if (match.bySourceUrl) return 0;
  if (match.bySourceVideoAssetIdentity) return 1;
  if (
    match.bySourceVideoPath &&
    entry.sourceVideoAssetIdentities.length === 0
  ) {
    return 2;
  }
  if (match.bySourceVideoPath && !requestedSourceVideoAssetIdentity) {
    return 3;
  }
  return null;
}

function rankEntryForTargetLanguage(
  entry: StoredSubtitleEntry,
  normalizedTargetLanguage: string | null
): number {
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
}

function detachCompetingPathOwners(args: {
  index: StoredSubtitleIndex;
  chosenEntry: StoredSubtitleEntry;
  sourceVideoPath: string;
  sourceVideoAssetIdentity: string;
  sourceUrl: string;
}): boolean {
  const {
    index,
    chosenEntry,
    sourceVideoPath,
    sourceVideoAssetIdentity,
    sourceUrl,
  } = args;
  if (!sourceVideoPath) return false;

  let changed = false;

  for (const candidate of index.entries) {
    if (candidate.id === chosenEntry.id) continue;
    if (candidate.kind !== chosenEntry.kind) continue;
    if (candidate.targetLanguage !== chosenEntry.targetLanguage) continue;
    if (!candidate.sourceVideoPaths.includes(sourceVideoPath)) continue;

    const candidateMatchesSameIdentity =
      Boolean(sourceVideoAssetIdentity) &&
      candidate.sourceVideoAssetIdentities.includes(sourceVideoAssetIdentity);
    const candidateMatchesSameSourceUrl =
      Boolean(sourceUrl) && candidate.sourceUrls.includes(sourceUrl);
    if (candidateMatchesSameIdentity || candidateMatchesSameSourceUrl) {
      continue;
    }

    const nextSourceVideoPaths = candidate.sourceVideoPaths.filter(
      value => value !== sourceVideoPath
    );
    if (nextSourceVideoPaths.length === candidate.sourceVideoPaths.length) {
      continue;
    }

    candidate.sourceVideoPaths = nextSourceVideoPaths;
    candidate.updatedAt = new Date().toISOString();
    changed = true;
  }

  return changed;
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
  const normalizedSourceVideoAssetIdentity = normalizeSourceAssetIdentity(
    await resolveStoredSourceAssetIdentity(args.sourceVideoPath)
  );
  const normalizedTargetLanguage =
    args.kind === 'translation'
      ? normalizeTargetLanguage(args.targetLanguage)
      : null;
  if (!normalizedVideoPath && !normalizedSourceUrl) {
    throw new Error(
      'Cannot store subtitle history without a source identifier.'
    );
  }
  const index = await readIndex();
  const now = new Date().toISOString();

  const matchingEntries = index.entries
    .filter(
      candidate =>
        candidate.kind === args.kind &&
        (args.kind !== 'translation' ||
          candidate.targetLanguage === normalizedTargetLanguage)
    )
    .map(candidate => ({
      entry: candidate,
      bucket: getSaveSourceBucket(
        candidate,
        getSourceMatch(
          candidate,
          normalizedVideoPath,
          normalizedSourceUrl,
          normalizedSourceVideoAssetIdentity
        )
      ),
    }))
    .filter(
      (
        candidate
      ): candidate is { entry: StoredSubtitleEntry; bucket: number } =>
        candidate.bucket != null
    )
    .sort((left, right) => {
      if (left.bucket !== right.bucket) {
        return left.bucket - right.bucket;
      }
      return (
        Date.parse(right.entry.updatedAt) - Date.parse(left.entry.updatedAt)
      );
    });

  let entry = matchingEntries[0]?.entry ?? null;

  if (!entry) {
    entry = {
      id: crypto.randomUUID(),
      kind: args.kind,
      targetLanguage: normalizedTargetLanguage,
      filePath: '',
      sourceVideoPaths: [],
      sourceVideoAssetIdentities: [],
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
  entry.sourceVideoAssetIdentities = mergeAliases(
    entry.sourceVideoAssetIdentities,
    normalizedSourceVideoAssetIdentity
  );
  entry.sourceUrls = mergeAliases(entry.sourceUrls, normalizedSourceUrl);
  entry.updatedAt = now;
  detachCompetingPathOwners({
    index,
    chosenEntry: entry,
    sourceVideoPath: normalizedVideoPath,
    sourceVideoAssetIdentity: normalizedSourceVideoAssetIdentity,
    sourceUrl: normalizedSourceUrl,
  });
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
  const normalizedSourceVideoAssetIdentity = normalizeSourceAssetIdentity(
    await resolveStoredSourceAssetIdentity(args.sourceVideoPath)
  );
  const normalizedTargetLanguage = normalizeTargetLanguage(args.targetLanguage);
  if (!normalizedVideoPath && !normalizedSourceUrl) {
    return { entry: null };
  }

  const index = await readIndex();
  const matchedEntryIds = new Set<string>();
  const availableEntries: Array<{
    entry: StoredSubtitleEntry;
    bucket: number;
  }> = [];
  let pruned = false;

  for (const entry of index.entries) {
    const match = getSourceMatch(
      entry,
      normalizedVideoPath,
      normalizedSourceUrl,
      normalizedSourceVideoAssetIdentity
    );
    const bucket = getFindSourceBucket(
      entry,
      match,
      normalizedSourceVideoAssetIdentity
    );
    if (bucket == null) {
      continue;
    }
    matchedEntryIds.add(entry.id);
    if (!(await fileExists(entry.filePath))) {
      pruned = true;
      continue;
    }
    availableEntries.push({ entry, bucket });
  }

  if (pruned) {
    index.entries = index.entries.filter(
      entry =>
        !matchedEntryIds.has(entry.id) ||
        availableEntries.some(candidate => candidate.entry.id === entry.id)
    );
    await writeIndex(index);
  }

  const compatibleEntries = normalizedTargetLanguage
    ? availableEntries.filter(
        candidate =>
          candidate.entry.kind !== 'translation' ||
          candidate.entry.targetLanguage === normalizedTargetLanguage
      )
    : availableEntries;

  if (compatibleEntries.length === 0) {
    return { entry: null };
  }

  compatibleEntries.sort((left, right) => {
    if (left.bucket !== right.bucket) {
      return left.bucket - right.bucket;
    }

    const rankDiff =
      rankEntryForTargetLanguage(left.entry, normalizedTargetLanguage) -
      rankEntryForTargetLanguage(right.entry, normalizedTargetLanguage);
    if (rankDiff !== 0) return rankDiff;

    return Date.parse(right.entry.updatedAt) - Date.parse(left.entry.updatedAt);
  });

  const winner = compatibleEntries[0].entry;
  const content = await fs.readFile(winner.filePath, 'utf8');
  return { entry: winner, content };
}

export async function syncStoredSubtitleVideoPath(args: {
  previousPath: string;
  savedPath: string;
}): Promise<boolean> {
  const previousPath = normalizeVideoPath(args.previousPath);
  const savedPath = normalizeVideoPath(args.savedPath);
  const savedSourceVideoAssetIdentity = normalizeSourceAssetIdentity(
    await resolveStoredSourceAssetIdentity(args.savedPath)
  );
  if (!previousPath || !savedPath) return false;

  const index = await readIndex();
  let changed = false;

  for (const entry of index.entries) {
    if (!entry.sourceVideoPaths.includes(previousPath)) {
      continue;
    }
    entry.sourceVideoPaths = mergeAliases(entry.sourceVideoPaths, savedPath);
    entry.sourceVideoAssetIdentities = mergeAliases(
      entry.sourceVideoAssetIdentities,
      savedSourceVideoAssetIdentity
    );
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
  const sourceVideoAssetIdentity = normalizeSourceAssetIdentity(
    await resolveStoredSourceAssetIdentity(args.sourceVideoPath)
  );
  if (!entryId || !sourceVideoPath) return false;

  const index = await readIndex();
  const entry =
    index.entries.find(candidate => candidate.id === entryId) ?? null;
  if (!entry) return false;
  const nextSourceVideoPaths = mergeAliases(
    entry.sourceVideoPaths,
    sourceVideoPath
  );
  const nextSourceVideoAssetIdentities = mergeAliases(
    entry.sourceVideoAssetIdentities,
    sourceVideoAssetIdentity
  );
  const changed =
    nextSourceVideoPaths.length !== entry.sourceVideoPaths.length ||
    nextSourceVideoAssetIdentities.length !==
      entry.sourceVideoAssetIdentities.length;
  if (!changed) return false;

  entry.sourceVideoPaths = nextSourceVideoPaths;
  entry.sourceVideoAssetIdentities = nextSourceVideoAssetIdentities;
  entry.updatedAt = new Date().toISOString();
  await writeIndex(index);
  return true;
}

export async function detachStoredSubtitleSource(args: {
  entryId: string;
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
}): Promise<boolean> {
  const entryId = String(args.entryId || '').trim();
  const rawSourceVideoPath = String(args.sourceVideoPath || '').trim();
  const sourceVideoPath = normalizeVideoPath(rawSourceVideoPath);
  const sourceUrl = normalizeSourceUrl(args.sourceUrl);
  if (!entryId || (!sourceVideoPath && !sourceUrl)) return false;

  const index = await readIndex();
  const entry =
    index.entries.find(candidate => candidate.id === entryId) ?? null;
  if (!entry) return false;

  const nextSourceVideoPaths = sourceVideoPath
    ? entry.sourceVideoPaths.filter(value => value !== sourceVideoPath)
    : entry.sourceVideoPaths;
  const nextSourceUrls = sourceUrl
    ? entry.sourceUrls.filter(value => value !== sourceUrl)
    : entry.sourceUrls;
  const changed =
    nextSourceVideoPaths.length !== entry.sourceVideoPaths.length ||
    nextSourceUrls.length !== entry.sourceUrls.length;
  if (!changed) return false;

  if (nextSourceVideoPaths.length === 0 && nextSourceUrls.length === 0) {
    index.entries = index.entries.filter(
      candidate => candidate.id !== entry.id
    );
    await writeIndex(index);
    try {
      await fs.rm(entry.filePath, { force: true });
    } catch {
      // Do nothing
    }
    return true;
  }

  const detachedSourceVideoAssetIdentity = normalizeSourceAssetIdentity(
    await resolveStoredSourceAssetIdentity(rawSourceVideoPath)
  );
  const nextSourceVideoAssetIdentities =
    await collectStoredSourceAssetIdentities(nextSourceVideoPaths);
  const fallbackSourceVideoAssetIdentities = detachedSourceVideoAssetIdentity
    ? entry.sourceVideoAssetIdentities.filter(
        value => value !== detachedSourceVideoAssetIdentity
      )
    : [...entry.sourceVideoAssetIdentities];

  entry.sourceVideoPaths = nextSourceVideoPaths;
  entry.sourceUrls = nextSourceUrls;
  entry.sourceVideoAssetIdentities =
    nextSourceVideoAssetIdentities.length > 0
      ? nextSourceVideoAssetIdentities
      : fallbackSourceVideoAssetIdentities;
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

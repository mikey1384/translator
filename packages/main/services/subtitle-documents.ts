import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  DetachSubtitleDocumentSourceOptions,
  FindSubtitleDocumentForFileOptions,
  FindSubtitleDocumentForSourceOptions,
  SaveSubtitleDocumentRecordOptions,
  StoredSubtitleKind,
  SubtitleDisplayMode,
  SubtitleDocumentMeta,
  SubtitleDocumentLinkedFileRole,
  SrtSegment,
} from '@shared-types/app';
import { fingerprintSubtitleText } from '../../shared/helpers/subtitle-sidecar.js';
import { writeTextFileAtomically } from './saved-subtitle-metadata.js';
import { normalizeYoutubeWatchUrl } from './video-suggestions/shared.js';

const SUBTITLE_DOCUMENTS_DIR_NAME = 'subtitle-documents';
const DOCUMENTS_DIR_NAME = 'documents';
const INDEX_FILE_NAME = 'index.json';
const DOCUMENT_SCHEMA_VERSION = 1 as const;
const require = createRequire(import.meta.url);

type SubtitleDocumentLinkedFile = {
  path: string;
  srtFingerprint: string;
  role: SubtitleDocumentLinkedFileRole;
  mode: SubtitleDisplayMode | null;
  segmentsSnapshot?: SrtSegment[];
  updatedAt: string;
};

type SubtitleDocumentRecord = {
  version: typeof DOCUMENT_SCHEMA_VERSION;
  id: string;
  title: string | null;
  segments: SrtSegment[];
  sourceVideoPath: string | null;
  sourceVideoAssetIdentity: string | null;
  sourceUrl: string | null;
  subtitleKind: StoredSubtitleKind | null;
  targetLanguage: string | null;
  linkedFiles: SubtitleDocumentLinkedFile[];
  activeLinkedFilePath: string | null;
  activeLinkedFileMode: SubtitleDisplayMode | null;
  activeLinkedFileRole: SubtitleDocumentLinkedFileRole | null;
  transcriptionEngine: 'elevenlabs' | 'whisper' | null;
  createdAt: string;
  updatedAt: string;
};

type SubtitleDocumentIndexEntry = Omit<SubtitleDocumentRecord, 'segments'>;

type SubtitleDocumentIndex = {
  version: typeof DOCUMENT_SCHEMA_VERSION;
  documents: SubtitleDocumentIndexEntry[];
};

function getElectronApp(): { getPath(name: string): string } {
  return require('electron').app as { getPath(name: string): string };
}

function getDocumentsRootDir(rootDir?: string): string {
  return (
    rootDir ||
    path.join(getElectronApp().getPath('userData'), SUBTITLE_DOCUMENTS_DIR_NAME)
  );
}

function getDocumentsDir(rootDir?: string): string {
  return path.join(getDocumentsRootDir(rootDir), DOCUMENTS_DIR_NAME);
}

function getIndexPath(rootDir?: string): string {
  return path.join(getDocumentsRootDir(rootDir), INDEX_FILE_NAME);
}

function getDocumentPath(documentId: string, rootDir?: string): string {
  return path.join(getDocumentsDir(rootDir), `${documentId}.json`);
}

function normalizePathValue(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  return normalized ? path.normalize(normalized) : null;
}

function normalizeSourceUrl(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

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
): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeTargetLanguage(
  value: string | null | undefined
): string | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized || null;
}

function normalizeSubtitleKind(
  value: StoredSubtitleKind | null | undefined
): StoredSubtitleKind | null {
  return value === 'transcription' || value === 'translation' ? value : null;
}

function normalizeSubtitleDisplayMode(
  value: SubtitleDisplayMode | null | undefined
): SubtitleDisplayMode | null {
  return value === 'original' || value === 'translation' || value === 'dual'
    ? value
    : null;
}

function normalizeLinkedFileRole(
  value: SubtitleDocumentLinkedFileRole | null | undefined
): SubtitleDocumentLinkedFileRole | null {
  return value === 'import' || value === 'export' ? value : null;
}

function deriveDocumentTitle(args: {
  title?: string | null;
  importFilePath?: string | null;
  exportFilePath?: string | null;
  sourceVideoPath?: string | null;
}): string | null {
  const title = String(args.title || '').trim();
  if (title) return title;

  const candidatePath =
    normalizePathValue(args.importFilePath) ||
    normalizePathValue(args.exportFilePath) ||
    normalizePathValue(args.sourceVideoPath);
  if (!candidatePath) return null;

  const baseName = path.basename(candidatePath).trim();
  return baseName || null;
}

function buildDocumentMeta(
  record: SubtitleDocumentIndexEntry | SubtitleDocumentRecord
): SubtitleDocumentMeta {
  const latestImportFile = getLatestLinkedFile(record.linkedFiles, 'import');
  const latestExportFile = getLatestLinkedFile(record.linkedFiles, 'export');
  const activeLinkedFile = resolveActiveLinkedFile(record);

  return {
    id: record.id,
    title: record.title,
    sourceVideoPath: record.sourceVideoPath,
    sourceVideoAssetIdentity: record.sourceVideoAssetIdentity,
    sourceUrl: record.sourceUrl,
    subtitleKind: record.subtitleKind,
    targetLanguage: record.targetLanguage,
    importFilePath: latestImportFile?.path ?? null,
    lastExportPath: latestExportFile?.path ?? null,
    activeLinkedFilePath: activeLinkedFile?.path ?? null,
    activeLinkedFileMode: activeLinkedFile?.mode ?? null,
    activeLinkedFileRole: activeLinkedFile?.role ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    transcriptionEngine: record.transcriptionEngine,
  };
}

function getLatestLinkedFile(
  linkedFiles: SubtitleDocumentLinkedFile[],
  role: SubtitleDocumentLinkedFileRole
): SubtitleDocumentLinkedFile | null {
  return (
    [...linkedFiles]
      .filter(link => link.role === role)
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      )[0] ?? null
  );
}

function resolveActiveLinkedFile(
  record: Pick<
    SubtitleDocumentRecord,
    | 'linkedFiles'
    | 'activeLinkedFilePath'
    | 'activeLinkedFileMode'
    | 'activeLinkedFileRole'
  >
): {
  path: string;
  mode: SubtitleDisplayMode | null;
  role: SubtitleDocumentLinkedFileRole | null;
} | null {
  const explicitPath = normalizePathValue(record.activeLinkedFilePath);
  const explicitMode = normalizeSubtitleDisplayMode(
    record.activeLinkedFileMode
  );
  const explicitRole = normalizeLinkedFileRole(record.activeLinkedFileRole);

  if (explicitPath) {
    const linkedMatch =
      record.linkedFiles.find(
        link =>
          link.path === explicitPath &&
          (!explicitRole || link.role === explicitRole)
      ) ?? record.linkedFiles.find(link => link.path === explicitPath);
    return {
      path: explicitPath,
      mode: explicitMode ?? linkedMatch?.mode ?? null,
      role: explicitRole ?? linkedMatch?.role ?? null,
    };
  }

  if (record.linkedFiles.length === 1) {
    const [onlyLink] = record.linkedFiles;
    return {
      path: onlyLink.path,
      mode: onlyLink.mode ?? null,
      role: onlyLink.role,
    };
  }

  const latestExport = getLatestLinkedFile(record.linkedFiles, 'export');
  if (latestExport) {
    return {
      path: latestExport.path,
      mode: latestExport.mode ?? null,
      role: latestExport.role,
    };
  }

  const latestImport = getLatestLinkedFile(record.linkedFiles, 'import');
  if (!latestImport) {
    return null;
  }

  return {
    path: latestImport.path,
    mode: latestImport.mode ?? null,
    role: latestImport.role,
  };
}

async function ensureDocumentDirs(rootDir?: string): Promise<void> {
  await fs.mkdir(getDocumentsDir(rootDir), { recursive: true });
}

function sanitizeLinkedFile(input: unknown): SubtitleDocumentLinkedFile | null {
  const raw = input && typeof input === 'object' ? (input as any) : null;
  if (!raw) return null;
  const role = normalizeLinkedFileRole(raw.role);
  const filePath = normalizePathValue(raw.path);
  const srtFingerprint = String(raw.srtFingerprint || '').trim();
  const mode = normalizeSubtitleDisplayMode(raw.mode);
  const updatedAt =
    String(raw.updatedAt || '').trim() || new Date().toISOString();
  if (!role || !filePath || !srtFingerprint) {
    return null;
  }
  return {
    role,
    path: filePath,
    srtFingerprint,
    mode,
    segmentsSnapshot: Array.isArray(raw.segmentsSnapshot)
      ? cloneSegments(raw.segmentsSnapshot as SrtSegment[])
      : undefined,
    updatedAt,
  };
}

function cloneSegments(segments: SrtSegment[]): SrtSegment[] {
  return segments.map(segment => ({
    ...segment,
    words: Array.isArray(segment.words)
      ? segment.words.map(word => ({ ...word }))
      : segment.words,
  }));
}

function sanitizeDocumentRecord(input: unknown): SubtitleDocumentRecord | null {
  const raw = input && typeof input === 'object' ? (input as any) : null;
  if (!raw) return null;
  const id = String(raw.id || '').trim();
  const createdAt = String(raw.createdAt || '').trim();
  const updatedAt = String(raw.updatedAt || '').trim();
  if (!id || !Array.isArray(raw.segments) || !createdAt || !updatedAt) {
    return null;
  }

  return {
    version: DOCUMENT_SCHEMA_VERSION,
    id,
    title: String(raw.title || '').trim() || null,
    segments: raw.segments as SrtSegment[],
    sourceVideoPath: normalizePathValue(raw.sourceVideoPath),
    sourceVideoAssetIdentity: normalizeSourceAssetIdentity(
      raw.sourceVideoAssetIdentity
    ),
    sourceUrl: normalizeSourceUrl(raw.sourceUrl),
    subtitleKind: normalizeSubtitleKind(raw.subtitleKind),
    targetLanguage: normalizeTargetLanguage(raw.targetLanguage),
    linkedFiles: Array.isArray(raw.linkedFiles)
      ? (raw.linkedFiles as unknown[])
          .map(link => sanitizeLinkedFile(link))
          .filter((link): link is SubtitleDocumentLinkedFile => Boolean(link))
      : [],
    activeLinkedFilePath: normalizePathValue(raw.activeLinkedFilePath),
    activeLinkedFileMode: normalizeSubtitleDisplayMode(
      raw.activeLinkedFileMode
    ),
    activeLinkedFileRole: normalizeLinkedFileRole(raw.activeLinkedFileRole),
    transcriptionEngine:
      raw.transcriptionEngine === 'elevenlabs' ||
      raw.transcriptionEngine === 'whisper'
        ? raw.transcriptionEngine
        : null,
    createdAt,
    updatedAt,
  };
}

function sanitizeDocumentIndexEntry(
  input: unknown
): SubtitleDocumentIndexEntry | null {
  const record = sanitizeDocumentRecord({
    ...(input && typeof input === 'object' ? input : {}),
    segments: [],
  });
  if (!record) return null;
  const { segments: _segments, ...indexEntry } = record;
  return indexEntry;
}

async function readIndex(rootDir?: string): Promise<SubtitleDocumentIndex> {
  await ensureDocumentDirs(rootDir);
  try {
    const raw = await fs.readFile(getIndexPath(rootDir), 'utf8');
    const parsed = JSON.parse(raw) as { documents?: unknown };
    const documents = Array.isArray(parsed.documents)
      ? parsed.documents
          .map(entry => sanitizeDocumentIndexEntry(entry))
          .filter((entry): entry is SubtitleDocumentIndexEntry =>
            Boolean(entry)
          )
      : [];

    return {
      version: DOCUMENT_SCHEMA_VERSION,
      documents,
    };
  } catch {
    return {
      version: DOCUMENT_SCHEMA_VERSION,
      documents: [],
    };
  }
}

async function writeIndex(
  index: SubtitleDocumentIndex,
  rootDir?: string
): Promise<void> {
  await ensureDocumentDirs(rootDir);
  await writeTextFileAtomically(
    getIndexPath(rootDir),
    `${JSON.stringify(index, null, 2)}\n`
  );
}

async function readDocumentRecord(
  documentId: string,
  rootDir?: string
): Promise<SubtitleDocumentRecord | null> {
  try {
    const raw = await fs.readFile(getDocumentPath(documentId, rootDir), 'utf8');
    return sanitizeDocumentRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeDocumentRecord(
  record: SubtitleDocumentRecord,
  rootDir?: string
): Promise<void> {
  await ensureDocumentDirs(rootDir);
  await writeTextFileAtomically(
    getDocumentPath(record.id, rootDir),
    `${JSON.stringify(record, null, 2)}\n`
  );
}

function mergeLinkedFile(
  links: SubtitleDocumentLinkedFile[],
  link: SubtitleDocumentLinkedFile | null
): SubtitleDocumentLinkedFile[] {
  if (!link) return links;
  const nextLinks = links.filter(
    existing => !(existing.path === link.path && existing.role === link.role)
  );
  nextLinks.push(link);
  nextLinks.sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  );
  return nextLinks;
}

function buildLinkedFile(args: {
  filePath?: string | null;
  srtContent?: string | null;
  mode?: SubtitleDisplayMode | null;
  segmentsSnapshot?: SrtSegment[] | null;
  role: SubtitleDocumentLinkedFileRole;
  updatedAt: string;
}): SubtitleDocumentLinkedFile | null {
  const filePath = normalizePathValue(args.filePath);
  const srtContent = String(args.srtContent || '');
  if (!filePath || !srtContent.trim()) {
    return null;
  }

  return {
    path: filePath,
    role: args.role,
    srtFingerprint: fingerprintSubtitleText(srtContent),
    mode: args.mode ?? null,
    segmentsSnapshot:
      Array.isArray(args.segmentsSnapshot) && args.segmentsSnapshot.length > 0
        ? cloneSegments(args.segmentsSnapshot)
        : undefined,
    updatedAt: args.updatedAt,
  };
}

function pathsEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  return normalizePathValue(a) === normalizePathValue(b);
}

function resolveActiveLinkedFileState(args: {
  options: SaveSubtitleDocumentRecordOptions;
  existing?: SubtitleDocumentRecord | null;
}): {
  path: string | null;
  mode: SubtitleDisplayMode | null;
  role: SubtitleDocumentLinkedFileRole | null;
} {
  const explicitPathProvided = 'activeLinkedFilePath' in args.options;
  const explicitModeProvided = 'activeLinkedFileMode' in args.options;
  const explicitRoleProvided = 'activeLinkedFileRole' in args.options;

  const path = explicitPathProvided
    ? normalizePathValue(args.options.activeLinkedFilePath)
    : (args.existing?.activeLinkedFilePath ?? null);
  const mode =
    path == null
      ? null
      : explicitModeProvided
        ? normalizeSubtitleDisplayMode(args.options.activeLinkedFileMode)
        : (args.existing?.activeLinkedFileMode ?? null);
  const role =
    path == null
      ? null
      : explicitRoleProvided
        ? normalizeLinkedFileRole(args.options.activeLinkedFileRole)
        : (args.existing?.activeLinkedFileRole ?? null);

  return {
    path,
    mode,
    role,
  };
}

function resolveImportLinkedFileArgs(args: {
  options: SaveSubtitleDocumentRecordOptions;
  updatedAt: string;
}): SubtitleDocumentLinkedFile | null {
  const importFilePath = args.options.importFilePath;
  const explicitImportContent = String(args.options.importSrtContent || '');
  const sameFileAsExport = pathsEqual(
    args.options.importFilePath,
    args.options.exportFilePath
  );
  const compatibilityImportContent =
    !normalizePathValue(args.options.exportFilePath) &&
    String(args.options.exportSrtContent || '').trim()
      ? args.options.exportSrtContent
      : null;
  const importSrtContent = explicitImportContent.trim()
    ? explicitImportContent
    : sameFileAsExport
      ? args.options.exportSrtContent
      : compatibilityImportContent;

  return buildLinkedFile({
    filePath: importFilePath,
    srtContent: importSrtContent,
    mode: args.options.importMode,
    segmentsSnapshot: importSrtContent ? args.options.segments : null,
    role: 'import',
    updatedAt: args.updatedAt,
  });
}

export async function saveSubtitleDocumentRecord(
  options: SaveSubtitleDocumentRecordOptions & {
    rootDir?: string;
  }
): Promise<SubtitleDocumentMeta> {
  if (!Array.isArray(options.segments)) {
    throw new Error('Subtitle document save requires subtitle segments.');
  }

  const existing =
    options.documentId && String(options.documentId).trim()
      ? await readDocumentRecord(
          String(options.documentId).trim(),
          options.rootDir
        )
      : null;
  const now = new Date().toISOString();
  const activeLinkedFile = resolveActiveLinkedFileState({
    options,
    existing,
  });

  const record: SubtitleDocumentRecord = {
    version: DOCUMENT_SCHEMA_VERSION,
    id: existing?.id || crypto.randomUUID(),
    title:
      deriveDocumentTitle({
        title: options.title,
        importFilePath: options.importFilePath,
        exportFilePath: options.exportFilePath,
        sourceVideoPath: options.sourceVideoPath,
      }) ??
      existing?.title ??
      null,
    segments: options.segments.map(segment => ({ ...segment })),
    sourceVideoPath:
      normalizePathValue(options.sourceVideoPath) ??
      existing?.sourceVideoPath ??
      null,
    sourceVideoAssetIdentity:
      normalizeSourceAssetIdentity(options.sourceVideoAssetIdentity) ??
      existing?.sourceVideoAssetIdentity ??
      null,
    sourceUrl:
      normalizeSourceUrl(options.sourceUrl) ?? existing?.sourceUrl ?? null,
    subtitleKind:
      normalizeSubtitleKind(options.subtitleKind) ??
      existing?.subtitleKind ??
      null,
    targetLanguage:
      normalizeTargetLanguage(options.targetLanguage) ??
      existing?.targetLanguage ??
      null,
    linkedFiles: mergeLinkedFile(
      mergeLinkedFile(
        existing?.linkedFiles ?? [],
        resolveImportLinkedFileArgs({
          options,
          updatedAt: now,
        })
      ),
      buildLinkedFile({
        filePath: options.exportFilePath,
        srtContent: options.exportSrtContent,
        mode: options.exportMode,
        segmentsSnapshot: options.segments,
        role: 'export',
        updatedAt: now,
      })
    ),
    activeLinkedFilePath: activeLinkedFile.path,
    activeLinkedFileMode: activeLinkedFile.mode,
    activeLinkedFileRole: activeLinkedFile.role,
    transcriptionEngine:
      options.transcriptionEngine !== undefined
        ? (options.transcriptionEngine ?? null)
        : (existing?.transcriptionEngine ?? null),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await writeDocumentRecord(record, options.rootDir);

  const index = await readIndex(options.rootDir);
  const { segments: _segments, ...nextEntry } = record;
  const filteredDocuments = index.documents.filter(
    document => document.id !== record.id
  );
  filteredDocuments.unshift(nextEntry);
  await writeIndex(
    {
      version: DOCUMENT_SCHEMA_VERSION,
      documents: filteredDocuments,
    },
    options.rootDir
  );

  return buildDocumentMeta(record);
}

export async function readSubtitleDocument(options: {
  documentId: string;
  rootDir?: string;
}): Promise<{ document: SubtitleDocumentMeta; segments: SrtSegment[] } | null> {
  const documentId = String(options.documentId || '').trim();
  if (!documentId) {
    return null;
  }
  const record = await readDocumentRecord(documentId, options.rootDir);
  if (!record) {
    return null;
  }
  return {
    document: buildDocumentMeta(record),
    segments: record.segments.map(segment => ({ ...segment })),
  };
}

export async function detachSubtitleDocumentSource(
  options: DetachSubtitleDocumentSourceOptions & {
    rootDir?: string;
  }
): Promise<SubtitleDocumentMeta | null> {
  const documentId = String(options.documentId || '').trim();
  if (!documentId) {
    return null;
  }

  const record = await readDocumentRecord(documentId, options.rootDir);
  if (!record) {
    return null;
  }

  if (
    !record.sourceVideoPath &&
    !record.sourceVideoAssetIdentity &&
    !record.sourceUrl
  ) {
    return buildDocumentMeta(record);
  }

  const nextRecord: SubtitleDocumentRecord = {
    ...record,
    sourceVideoPath: null,
    sourceVideoAssetIdentity: null,
    sourceUrl: null,
    updatedAt: new Date().toISOString(),
  };

  await writeDocumentRecord(nextRecord, options.rootDir);

  const index = await readIndex(options.rootDir);
  const { segments: _segments, ...nextEntry } = nextRecord;
  const filteredDocuments = index.documents.filter(
    document => document.id !== nextRecord.id
  );
  filteredDocuments.unshift(nextEntry);
  await writeIndex(
    {
      version: DOCUMENT_SCHEMA_VERSION,
      documents: filteredDocuments,
    },
    options.rootDir
  );

  return buildDocumentMeta(nextRecord);
}

export async function findSubtitleDocumentForFile(
  options: FindSubtitleDocumentForFileOptions & {
    rootDir?: string;
  }
): Promise<{
  document: SubtitleDocumentMeta;
  segments?: SrtSegment[];
  fileMode?: SubtitleDisplayMode | null;
  fileRole?: SubtitleDocumentLinkedFileRole | null;
} | null> {
  const filePath = normalizePathValue(options.filePath);
  const srtContent = String(options.srtContent || '');
  if (!filePath || !srtContent.trim()) {
    return null;
  }
  const targetFingerprint = fingerprintSubtitleText(srtContent);
  const index = await readIndex(options.rootDir);
  const match = index.documents.find(document =>
    document.linkedFiles.some(
      link =>
        link.path === filePath && link.srtFingerprint === targetFingerprint
    )
  );
  if (!match) {
    return null;
  }
  const record = await readDocumentRecord(match.id, options.rootDir);
  if (!record) {
    return null;
  }
  const matchedLink = record.linkedFiles.find(
    link => link.path === filePath && link.srtFingerprint === targetFingerprint
  );
  return {
    document: buildDocumentMeta(record),
    segments: matchedLink?.segmentsSnapshot
      ? cloneSegments(matchedLink.segmentsSnapshot)
      : undefined,
    fileMode: matchedLink?.mode ?? null,
    fileRole: matchedLink?.role ?? null,
  };
}

function scoreSourceMatch(
  document: SubtitleDocumentIndexEntry,
  options: FindSubtitleDocumentForSourceOptions
): number {
  const requestedSourceUrl = normalizeSourceUrl(options.sourceUrl);
  const requestedAssetIdentity = normalizeSourceAssetIdentity(
    options.sourceVideoAssetIdentity
  );
  const requestedPath = normalizePathValue(options.sourceVideoPath);
  const requestedSubtitleKind = normalizeSubtitleKind(options.subtitleKind);
  const requestedTargetLanguage = normalizeTargetLanguage(
    options.targetLanguage
  );

  if (
    requestedSubtitleKind &&
    document.subtitleKind !== requestedSubtitleKind
  ) {
    return 0;
  }
  if (
    requestedTargetLanguage &&
    document.targetLanguage !== requestedTargetLanguage
  ) {
    return 0;
  }

  const hasConflictingSourceUrl = Boolean(
    requestedSourceUrl &&
    document.sourceUrl &&
    document.sourceUrl !== requestedSourceUrl
  );
  const hasConflictingAssetIdentity = Boolean(
    requestedAssetIdentity &&
    document.sourceVideoAssetIdentity &&
    document.sourceVideoAssetIdentity !== requestedAssetIdentity
  );

  if (hasConflictingSourceUrl || hasConflictingAssetIdentity) {
    return 0;
  }

  if (requestedSourceUrl && document.sourceUrl === requestedSourceUrl) {
    return 3;
  }
  if (
    requestedAssetIdentity &&
    document.sourceVideoAssetIdentity === requestedAssetIdentity
  ) {
    return 2;
  }
  if (requestedPath && document.sourceVideoPath === requestedPath) {
    return 1;
  }
  return 0;
}

export async function findSubtitleDocumentForSource(
  options: FindSubtitleDocumentForSourceOptions & {
    rootDir?: string;
  }
): Promise<{ document: SubtitleDocumentMeta; segments: SrtSegment[] } | null> {
  const index = await readIndex(options.rootDir);
  const ranked = index.documents
    .map(document => ({
      document,
      score: scoreSourceMatch(document, options),
    }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return (
        Date.parse(right.document.updatedAt) -
        Date.parse(left.document.updatedAt)
      );
    });

  const winner = ranked[0]?.document;
  if (!winner) {
    return null;
  }
  return readSubtitleDocument({
    documentId: winner.id,
    rootDir: options.rootDir,
  });
}

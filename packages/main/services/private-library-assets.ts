import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { VideoSuggestionDownloadHistoryItem } from '@shared-types/app';
import { canonicalVideoSourceKey } from '../../shared/helpers/video-url.js';
import { getSubtitleSidecarPath } from '../../shared/helpers/subtitle-sidecar.js';
import { withLock } from './async-lock.js';
import { PrivateLibraryError } from './private-library-crypto.js';
import {
  writePrivateAtomic,
  type PrivateTransferPlan,
  type PrivateEntry,
} from './private-library.js';

type Row = Record<string, any>;
const definitions = [
  {
    directory: 'subtitle-history',
    file: 'index.json',
    key: 'entries',
    lock: 'subtitle-library-index',
  },
  {
    directory: 'subtitle-documents',
    file: 'index.json',
    key: 'documents',
    lock: 'subtitle-documents-index',
  },
  {
    directory: 'transcript-analysis-history',
    file: 'index.json',
    key: 'entries',
    lock: 'transcript-analysis-index',
  },
  {
    directory: 'highlight-clips',
    file: 'clip-index.json',
    key: 'clips',
    lock: 'highlight-clip-index',
  },
] as const;
function under(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    !!relative &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}
function normalized(file: unknown): string {
  return typeof file === 'string'
    ? path.normalize(file).replace(/\\/g, '/').toLowerCase()
    : '';
}
function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(v => typeof v === 'string')
    : typeof value === 'string'
      ? [value]
      : [];
}
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
async function readJson(file: string): Promise<Row | null> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile()) throw new PrivateLibraryError('corrupt');
    // These are the app's whole-library indexes, which can legitimately contain
    // many linked subtitle snapshots. Match their owning services' readers;
    // the encrypted per-entry JSON retains its separate bounded size check.
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error: any) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function assertOwnedAssetParent(
  realUserData: string,
  file: string,
  error: 'unsupported_file' | 'source_changed'
): Promise<void> {
  // Resolve both sides. Electron's configured root can differ from the disk's
  // spelling on case-insensitive volumes, or itself be an intentional alias.
  // Keep case-sensitive containment of real paths so child links cannot escape.
  const realParent = await fs.realpath(path.dirname(file));
  if (realParent !== realUserData && !under(realUserData, realParent))
    throw new PrivateLibraryError(error);
}
async function assertUnsharedSourcePaths(
  row: Row,
  videoPath: string | undefined,
  error: 'unsupported_file' | 'source_changed'
): Promise<void> {
  for (const alias of list(row.sourceVideoPaths ?? row.sourceVideoPath)) {
    if (normalized(alias) === normalized(videoPath)) continue;
    try {
      await fs.lstat(alias);
    } catch (cause: any) {
      // Catalogs retain previous locations after a move. Missing aliases are
      // provenance, not another live owner. A dangling link still counts as an
      // owner; permission and I/O failures must never be mistaken for absence.
      if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') continue;
      throw new PrivateLibraryError(error);
    }
    throw new PrivateLibraryError(error);
  }
}
export function withPrivateAssetLocks<T>(work: () => Promise<T>): Promise<T> {
  const lock = (i: number): Promise<T> =>
    i === definitions.length
      ? work()
      : withLock(definitions[i].lock, () => lock(i + 1));
  return lock(0);
}

/** Collect only Translator-owned storage. User exports and agent workspaces are
 * independent copies and are explicitly excluded from folder protection. */
export async function collectPrivateAssets(
  userData: string,
  item: VideoSuggestionDownloadHistoryItem
): Promise<PrivateTransferPlan> {
  if (
    !item.localPath ||
    path.dirname(item.localPath) !== path.join(userData, 'downloaded-media')
  )
    throw new PrivateLibraryError('managed_only');
  const realUserData = await fs.realpath(userData);
  const plan: PrivateTransferPlan = { files: [], indexes: [] };
  const paths = new Set<string>();
  const libraryIds = new Set<string>();
  const assetIds = new Set<string>();
  const fileIdentity = async (file: string) => {
    const s = await fs.lstat(file);
    if (!s.isFile() || s.nlink > 1)
      throw new PrivateLibraryError('unsupported_file');
    return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}`;
  };
  const add = async (
    file: string,
    kind: 'video' | 'subtitle' | 'data',
    label?: string,
    mime?: string,
    optional = false
  ) => {
    if (paths.has(file)) return;
    if (!under(userData, file))
      throw new PrivateLibraryError('unsupported_file');
    // Resolve every parent too; a symlinked app subdirectory cannot escape.
    try {
      await assertOwnedAssetParent(realUserData, file, 'unsupported_file');
      const identity = await fileIdentity(file);
      paths.add(file);
      plan.files.push({ sourcePath: file, kind, label, mime, identity });
    } catch (error: any) {
      if (optional && error.code === 'ENOENT') return;
      throw error;
    }
  };
  const matches = (row: Row) => {
    const sourcePaths = list(row.sourceVideoPaths ?? row.sourceVideoPath);
    if (sourcePaths.some(p => normalized(p) === normalized(item.localPath)))
      return true;
    if (list(row.libraryEntryIds).some(id => libraryIds.has(id))) return true;
    // A shared webpage is not a video identity. Nor should a stale URL alias
    // absorb documents already assigned to another local asset.
    return (
      !item.webVideoId &&
      !sourcePaths.length &&
      list(row.sourceUrls ?? row.sourceUrl).some(
        url =>
          !!canonicalVideoSourceKey(url) &&
          canonicalVideoSourceKey(url) ===
            canonicalVideoSourceKey(item.sourceUrl)
      )
    );
  };
  const stat = await fs.stat(item.localPath);
  assetIds.add(
    `${stat.dev}:${stat.ino}:${stat.size}:${Math.round(stat.mtimeMs)}:${Math.round(stat.birthtimeMs)}`
  );
  const mime =
    path.extname(item.localPath).toLowerCase() === '.webm'
      ? 'video/webm'
      : path.extname(item.localPath).toLowerCase() === '.mkv'
        ? 'video/x-matroska'
        : 'video/mp4';
  await add(item.localPath, 'video', item.title, mime);
  await add(
    getSubtitleSidecarPath(item.localPath),
    'data',
    undefined,
    undefined,
    true
  );
  for (const d of definitions) {
    const indexPath = path.join(userData, d.directory, d.file);
    const index = await readJson(indexPath);
    if (!index) continue;
    if (!Array.isArray(index[d.key])) throw new PrivateLibraryError('corrupt');
    const sourceKeys = new Set([
      hash(`path:${normalized(item.localPath)}`),
      hash(`meta:${item.sourceUrl}|`),
      ...Array.from(assetIds, id => hash(`asset:${id}`)),
      ...Array.from(libraryIds, id => hash(`meta:${item.sourceUrl}|${id}`)),
    ]);
    const rows: Row[] = index[d.key].filter((row: Row) =>
      d.key === 'clips' ? sourceKeys.has(row.sourceKey) : matches(row)
    );
    if (!rows.length) continue;
    plan.indexes.push({ path: indexPath, key: d.key, records: rows });
    for (const row of rows) {
      // Never remove a document still associated with another existing source.
      await assertUnsharedSourcePaths(row, item.localPath, 'unsupported_file');
      for (const identity of list(
        row.sourceVideoAssetIdentities ?? row.sourceVideoAssetIdentity
      ))
        assetIds.add(identity);
      if (d.directory === 'subtitle-history') {
        libraryIds.add(row.id);
        const file = String(row.filePath || '');
        if (!under(path.join(userData, 'subtitle-history', 'entries'), file))
          throw new PrivateLibraryError('corrupt');
        await add(
          file,
          'subtitle',
          row.targetLanguage || row.kind,
          'application/x-subrip'
        );
        await add(
          getSubtitleSidecarPath(file),
          'data',
          undefined,
          undefined,
          true
        );
      } else if (d.directory === 'subtitle-documents') {
        if (typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(row.id))
          throw new PrivateLibraryError('corrupt');
        const documentPath = path.join(
          userData,
          d.directory,
          'documents',
          `${row.id}.json`
        );
        await add(
          documentPath,
          'subtitle',
          row.targetLanguage || row.subtitleKind,
          'application/x-stage5-subtitle-document'
        );
        for (const link of Array.isArray(row.linkedFiles)
          ? row.linkedFiles
          : []) {
          if (typeof link.path !== 'string') continue;
          await add(
            path.join(
              userData,
              'saved-subtitle-metadata',
              `${hash(path.normalize(link.path))}.json`
            ),
            'data',
            undefined,
            undefined,
            true
          );
        }
      } else if (d.directory === 'transcript-analysis-history') {
        const file = String(row.filePath || '');
        if (!under(path.join(userData, d.directory, 'entries'), file))
          throw new PrivateLibraryError('corrupt');
        await add(file, 'data');
      } else {
        const file = String(row.videoPath || '');
        if (path.dirname(file) !== path.join(userData, d.directory))
          throw new PrivateLibraryError('corrupt');
        await add(file, 'data');
      }
    }
  }
  return plan;
}

/** Validate the full snapshot before deleting anything. Retried cleanup accepts
 * already-removed records/files; it never deletes newer edits or other videos. */
export async function cleanPrivateAssets(
  userData: string,
  entry: PrivateEntry,
  removeHistory: () => void
): Promise<void> {
  const realUserData = await fs.realpath(userData);
  const replacements: { path: string; index: Row }[] = [];
  for (const change of entry.plan.indexes) {
    const definition = definitions.find(
      d =>
        change.path === path.join(userData, d.directory, d.file) &&
        change.key === d.key
    );
    if (!definition) throw new PrivateLibraryError('corrupt');
    // A previously missing alias may have been restored during encryption or
    // a pending transfer. Check even if an earlier cleanup removed the index.
    for (const saved of change.records)
      await assertUnsharedSourcePaths(
        saved,
        entry.item.localPath,
        'source_changed'
      );
    const index = await readJson(change.path);
    if (!index) continue;
    const rows = index[change.key];
    if (!Array.isArray(rows)) throw new PrivateLibraryError('corrupt');
    const identity = (row: Row) => row.id ?? row.videoPath;
    for (const saved of change.records) {
      const current = rows.find((r: Row) => identity(r) === identity(saved));
      if (current && JSON.stringify(current) !== JSON.stringify(saved))
        throw new PrivateLibraryError('source_changed');
    }
    replacements.push({
      path: change.path,
      index: {
        ...index,
        [change.key]: rows.filter(
          (row: Row) =>
            !change.records.some(saved => identity(saved) === identity(row))
        ),
      },
    });
  }
  for (const asset of entry.assets) {
    if (
      !under(userData, asset.sourcePath) ||
      ![
        'downloaded-media',
        'subtitle-history',
        'subtitle-documents',
        'saved-subtitle-metadata',
        'transcript-analysis-history',
        'highlight-clips',
      ].includes(path.relative(userData, asset.sourcePath).split(path.sep)[0])
    )
      throw new PrivateLibraryError('corrupt');
    try {
      await assertOwnedAssetParent(
        realUserData,
        asset.sourcePath,
        'source_changed'
      );
      const s = await fs.lstat(asset.sourcePath);
      if (
        !s.isFile() ||
        s.nlink > 1 ||
        `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}` !== asset.identity
      )
        throw new PrivateLibraryError('source_changed');
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  // Remove discoverability first. The encrypted pending entry is durable already.
  for (const change of replacements)
    await writePrivateAtomic(change.path, JSON.stringify(change.index));
  for (const asset of entry.assets)
    await fs.rm(asset.sourcePath, { force: true });
  removeHistory();
}

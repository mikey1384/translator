import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  StoredHighlightClip,
  StoredHighlightClipAspectMode,
  StoredHighlightClipKind,
} from '@shared-types/app';
import { withLock } from './async-lock.js';

// Rendered highlight clips live in userData/highlight-clips (see the
// outputToLibrary branch of the render handler). This index remembers which
// source and caption state each file was rendered for, so a reopened video
// gets its clips back. It never deletes clip files; it only forgets entries
// whose file is gone.

interface StoredHighlightClipIndex {
  version: 1;
  clips: StoredHighlightClipRecord[];
}

interface StoredHighlightClipRecord extends StoredHighlightClip {
  sourceKey: string;
}

interface RecordHighlightClipArgs {
  /** Source identity plus caption signature, as the clips panel builds it. */
  sourceIdentity: string;
  kind: StoredHighlightClipKind;
  artifactKey: string;
  aspectMode: StoredHighlightClipAspectMode;
  videoPath: string;
}

interface ListHighlightClipsArgs {
  sourceIdentity: string;
}

const require = createRequire(import.meta.url);
const INDEX_VERSION = 1 as const;
const CLIPS_DIR_NAME = 'highlight-clips';
const INDEX_FILE_NAME = 'clip-index.json';
const MAX_RECORDS = 1000;
const ASPECT_MODES: readonly StoredHighlightClipAspectMode[] = [
  'vertical_reframe',
  'vertical_fit',
  'original',
];
const KINDS: readonly StoredHighlightClipKind[] = ['single', 'combined'];

function getElectronApp(): { getPath(name: string): string } {
  return require('electron').app as { getPath(name: string): string };
}

function getIndexPath(rootDir?: string): string {
  return path.join(
    rootDir || path.join(getElectronApp().getPath('userData'), CLIPS_DIR_NAME),
    INDEX_FILE_NAME
  );
}

/** Caption signatures carry every cue, so key by digest instead. */
export function highlightClipSourceKey(sourceIdentity: string): string {
  return createHash('sha256').update(sourceIdentity, 'utf8').digest('hex');
}

function sanitizeRecord(input: unknown): StoredHighlightClipRecord | null {
  const raw = input && typeof input === 'object' ? (input as any) : null;
  if (!raw) return null;
  const sourceKey = String(raw.sourceKey || '').trim();
  const artifactKey = String(raw.artifactKey || '');
  const videoPath = String(raw.videoPath || '').trim();
  if (!/^[0-9a-f]{64}$/.test(sourceKey) || !artifactKey) return null;
  if (!KINDS.includes(raw.kind) || !ASPECT_MODES.includes(raw.aspectMode)) {
    return null;
  }
  if (!path.isAbsolute(videoPath) || !/\.mp4$/i.test(videoPath)) return null;
  return {
    sourceKey,
    kind: raw.kind,
    artifactKey,
    aspectMode: raw.aspectMode,
    videoPath,
    createdAt: String(raw.createdAt || '').trim() || new Date().toISOString(),
  };
}

async function readIndex(rootDir?: string): Promise<StoredHighlightClipIndex> {
  try {
    const parsed = JSON.parse(await fs.readFile(getIndexPath(rootDir), 'utf8'));
    const clips = Array.isArray(parsed?.clips)
      ? parsed.clips
          .map(sanitizeRecord)
          .filter((record: StoredHighlightClipRecord | null) => Boolean(record))
      : [];
    return { version: INDEX_VERSION, clips };
  } catch {
    return { version: INDEX_VERSION, clips: [] };
  }
}

async function writeIndex(
  index: StoredHighlightClipIndex,
  rootDir?: string
): Promise<void> {
  const indexPath = getIndexPath(rootDir);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  // Atomic replace so concurrent readers never see a partial file.
  const tmpPath = `${indexPath}.tmp-${process.pid}`;
  await fs.writeFile(tmpPath, JSON.stringify(index, null, 2) + '\n');
  await fs.rename(tmpPath, indexPath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function toPublic(record: StoredHighlightClipRecord): StoredHighlightClip {
  const { sourceKey: _sourceKey, ...clip } = record;
  return clip;
}

async function recordHighlightClipUnlocked(
  args: RecordHighlightClipArgs,
  rootDir?: string
): Promise<StoredHighlightClip> {
  const sourceIdentity = String(args?.sourceIdentity || '');
  if (!sourceIdentity) {
    throw new Error('Cannot remember a clip without its source identity.');
  }
  const record = sanitizeRecord({
    sourceKey: highlightClipSourceKey(sourceIdentity),
    kind: args.kind,
    artifactKey: args.artifactKey,
    aspectMode: args.aspectMode,
    videoPath: args.videoPath,
    createdAt: new Date().toISOString(),
  });
  if (!record) throw new Error('Invalid highlight clip record.');
  if (!(await fileExists(record.videoPath))) {
    throw new Error('The rendered clip file does not exist.');
  }

  const index = await readIndex(rootDir);
  // A newer render of the same clip for the same captions replaces the old
  // entry. The old file stays on disk untouched.
  index.clips = [
    record,
    ...index.clips.filter(
      clip =>
        clip.sourceKey !== record.sourceKey ||
        clip.kind !== record.kind ||
        clip.artifactKey !== record.artifactKey ||
        clip.aspectMode !== record.aspectMode
    ),
  ].slice(0, MAX_RECORDS);
  await writeIndex(index, rootDir);
  return toPublic(record);
}

async function listHighlightClipsUnlocked(
  args: ListHighlightClipsArgs,
  rootDir?: string
): Promise<StoredHighlightClip[]> {
  const sourceIdentity = String(args?.sourceIdentity || '');
  if (!sourceIdentity) return [];
  const sourceKey = highlightClipSourceKey(sourceIdentity);
  const index = await readIndex(rootDir);
  const available: StoredHighlightClipRecord[] = [];
  const missing = new Set<StoredHighlightClipRecord>();
  for (const clip of index.clips) {
    if (clip.sourceKey !== sourceKey) continue;
    if (await fileExists(clip.videoPath)) available.push(clip);
    else missing.add(clip);
  }
  if (missing.size > 0) {
    index.clips = index.clips.filter(clip => !missing.has(clip));
    await writeIndex(index, rootDir);
  }
  return available.map(toPublic);
}

const CLIP_INDEX_LOCK = 'highlight-clip-index';

export const recordHighlightClip = (
  ...args: Parameters<typeof recordHighlightClipUnlocked>
) => withLock(CLIP_INDEX_LOCK, () => recordHighlightClipUnlocked(...args));

export const listHighlightClips = (
  ...args: Parameters<typeof listHighlightClipsUnlocked>
) => withLock(CLIP_INDEX_LOCK, () => listHighlightClipsUnlocked(...args));

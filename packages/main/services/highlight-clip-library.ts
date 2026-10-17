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
// source each file was rendered for, and the clip's own caption signature, so
// a reopened video gets its clips back. The folder is the app's: a file whose
// entry is replaced or evicted is deleted, and files no entry references are
// swept once per session. Clips the user downloaded are copies elsewhere.

interface StoredHighlightClipIndex {
  version: 1;
  clips: StoredHighlightClipRecord[];
}

interface StoredHighlightClipRecord extends StoredHighlightClip {
  sourceKey: string;
}

interface RecordHighlightClipArgs {
  /** The source the clip was cut from (see highlightClipSourceIdentity). */
  sourceIdentity: string;
  /** The captions burned into this clip (highlightClipCaptionSignature). */
  captionSignature?: string;
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
const CLIP_INDEX_LOCK = 'highlight-clip-index';
const CLIPS_DIR_NAME = 'highlight-clips';
const INDEX_FILE_NAME = 'clip-index.json';
const MAX_RECORDS = 1000;
// A render copies its file in before it is recorded; never sweep a file that
// young, or a clip finishing right now could lose its file.
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;
const ASPECT_MODES: readonly StoredHighlightClipAspectMode[] = [
  'vertical_reframe',
  'vertical_fit',
  'original',
];
const KINDS: readonly StoredHighlightClipKind[] = ['single', 'combined'];

function getElectronApp(): { getPath(name: string): string } {
  return require('electron').app as { getPath(name: string): string };
}

function getClipsDir(rootDir?: string): string {
  return (
    rootDir || path.join(getElectronApp().getPath('userData'), CLIPS_DIR_NAME)
  );
}

function getIndexPath(rootDir?: string): string {
  return path.join(getClipsDir(rootDir), INDEX_FILE_NAME);
}

/** Source identities can be long (older ones carried every cue): digest. */
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
  const captionSignature = String(raw.captionSignature || '')
    .trim()
    .slice(0, 128);
  return {
    sourceKey,
    kind: raw.kind,
    artifactKey,
    aspectMode: raw.aspectMode,
    videoPath,
    createdAt: String(raw.createdAt || '').trim() || new Date().toISOString(),
    ...(captionSignature ? { captionSignature } : {}),
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

function isInsideDir(filePath: string, dir: string): boolean {
  const relative = path.relative(path.resolve(dir), path.resolve(filePath));
  return (
    Boolean(relative) &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  );
}

/** Delete clip files no remaining entry points at; only inside our folder. */
async function deleteUnreferencedFiles(
  candidates: readonly string[],
  remaining: readonly StoredHighlightClipRecord[],
  rootDir?: string
): Promise<void> {
  const dir = getClipsDir(rootDir);
  const referenced = new Set(
    remaining.map(clip => path.resolve(clip.videoPath))
  );
  for (const candidate of new Set(candidates.map(c => path.resolve(c)))) {
    if (referenced.has(candidate) || !isInsideDir(candidate, dir)) continue;
    if (!/\.mp4$/i.test(candidate)) continue;
    await fs.rm(candidate, { force: true }).catch(() => undefined);
  }
}

let sweptThisSession = false;

/**
 * Remove .mp4 files in the clips folder that no index entry references (from
 * renders that were never recorded, or entries forgotten by older versions).
 */
export async function sweepOrphanHighlightClips(
  rootDir?: string,
  now = Date.now()
): Promise<string[]> {
  const dir = getClipsDir(rootDir);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const index = await readIndex(rootDir);
  const referenced = new Set(
    index.clips.map(clip => path.resolve(clip.videoPath))
  );
  const removed: string[] = [];
  for (const name of names) {
    if (!/\.mp4$/i.test(name)) continue;
    const filePath = path.resolve(dir, name);
    if (referenced.has(filePath)) continue;
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || now - stat.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
      await fs.rm(filePath, { force: true });
      removed.push(filePath);
    } catch {
      // Unreadable or already gone; try again next session.
    }
  }
  return removed;
}

/** First use each session sweeps the real folder (tests pass a rootDir). */
function sweepOnce(rootDir?: string): void {
  if (sweptThisSession || rootDir) return;
  sweptThisSession = true;
  void withLock(CLIP_INDEX_LOCK, () => sweepOrphanHighlightClips()).catch(
    error => {
      console.warn('[highlight-clip-library] Orphan sweep failed:', error);
    }
  );
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
    captionSignature: args.captionSignature,
    createdAt: new Date().toISOString(),
  });
  if (!record) throw new Error('Invalid highlight clip record.');
  if (!(await fileExists(record.videoPath))) {
    throw new Error('The rendered clip file does not exist.');
  }

  const index = await readIndex(rootDir);
  // A newer render of the same clip replaces the old entry (whatever captions
  // it had), and the superseded or evicted files are deleted.
  const isSameClip = (clip: StoredHighlightClipRecord) =>
    clip.sourceKey === record.sourceKey &&
    clip.kind === record.kind &&
    clip.artifactKey === record.artifactKey &&
    clip.aspectMode === record.aspectMode;
  const superseded = index.clips.filter(isSameClip);
  const ordered = [record, ...index.clips.filter(clip => !isSameClip(clip))];
  const evicted = ordered.slice(MAX_RECORDS);
  index.clips = ordered.slice(0, MAX_RECORDS);
  await writeIndex(index, rootDir);
  await deleteUnreferencedFiles(
    [...superseded, ...evicted].map(clip => clip.videoPath),
    index.clips,
    rootDir
  );
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

export const recordHighlightClip = async (
  ...args: Parameters<typeof recordHighlightClipUnlocked>
) => {
  const result = await withLock(CLIP_INDEX_LOCK, () =>
    recordHighlightClipUnlocked(...args)
  );
  sweepOnce(args[1]);
  return result;
};

export const listHighlightClips = async (
  ...args: Parameters<typeof listHighlightClipsUnlocked>
) => {
  const result = await withLock(CLIP_INDEX_LOCK, () =>
    listHighlightClipsUnlocked(...args)
  );
  sweepOnce(args[1]);
  return result;
};

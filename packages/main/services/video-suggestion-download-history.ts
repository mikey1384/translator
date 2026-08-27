import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  VideoSuggestionDownloadHistoryItem,
  VideoSuggestionDownloadHistoryMutation,
  VideoSuggestionDownloadHistoryMutationResult,
} from '@shared-types/app';
import {
  sanitizeVideoSuggestionHistoryPath,
  sanitizeVideoSuggestionWebUrl,
} from '../../shared/helpers/video-suggestion-sanitize.js';

const MAX_HISTORY_ITEMS = 40;

// How long a freshly promoted file stays protected from reclamation while its
// renderer commits the matching history upsert. Entries restored from disk
// (dead sessions) carry no grace and are reclaimed immediately.
const PROMOTED_FILE_COMMIT_GRACE_MS = 5 * 60_000;

type PendingReclaimEntry = {
  filePath: string;
  notBefore: number;
  ownerToken?: string;
};

export type TrackedPromotedFileOwnership = {
  rollback: () => Promise<void>;
};

type ExplicitDeletionOperation = Extract<
  VideoSuggestionDownloadHistoryMutation,
  { type: 'delete-file' | 'delete-file-and-history' }
>['type'];

type ExplicitDeletionOutcome = NonNullable<
  VideoSuggestionDownloadHistoryMutationResult['deletion']
>;

type ExplicitDeletionHistoryState =
  | { state: 'pending'; itemIndex: number }
  | { state: 'committed' }
  | { state: 'conflict' };

export type PendingVideoSuggestionFileDeletionIntent = {
  version: 1;
  operation: ExplicitDeletionOperation;
  itemId: string;
  filePath: string;
};

// Upserts whose displaced entries are still restorable by a rollback. Bounded
// because rollbacks happen promptly after their upsert or not at all.
const MAX_DISPLACED_STASH = 8;

export type DownloadHistoryPersistence = {
  loadHistory: () => unknown;
  saveHistory: (items: VideoSuggestionDownloadHistoryItem[]) => void;
  loadPendingReclaims: () => unknown;
  savePendingReclaims: (paths: string[]) => void;
  loadPendingFileDeletions: () => unknown;
  savePendingFileDeletions: (
    intents: PendingVideoSuggestionFileDeletionIntent[]
  ) => void;
};

export type DownloadHistoryManagerOptions = {
  persistence: DownloadHistoryPersistence;
  isManagedLibraryPath: (filePath: string) => boolean;
  reclaimPaths: (filePaths: string[]) => Promise<string[]>;
  deleteManagedFile?: (
    filePath: string
  ) => Promise<'deleted' | 'already_absent'>;
  onMaintenanceError?: (error: unknown) => void;
  /** Test seam — production uses PROMOTED_FILE_COMMIT_GRACE_MS. */
  commitGraceMs?: number;
};

function normalizePath(value: unknown): string {
  const sanitized = sanitizeVideoSuggestionHistoryPath(value);
  if (!sanitized) return '';
  const resolved = path.resolve(sanitized);
  // Windows paths are normally case-insensitive. macOS must retain case here:
  // it can run on case-sensitive APFS/HFS volumes where Foo.mp4 and foo.mp4 are
  // distinct files with independent history and cleanup ownership.
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sanitizeHistoryItem(
  value: unknown
): VideoSuggestionDownloadHistoryItem | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<VideoSuggestionDownloadHistoryItem>;
  const sourceUrl = String(raw.sourceUrl || '').trim();
  if (!sourceUrl) return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const downloadedAtIso =
    String(raw.downloadedAtIso || '').trim() || new Date().toISOString();
  const title = String(raw.title || '').trim() || sourceUrl;
  const item: VideoSuggestionDownloadHistoryItem = {
    id,
    sourceUrl,
    title: title.slice(0, 300),
    downloadedAtIso,
  };
  const thumbnailUrl = String(raw.thumbnailUrl || '').trim();
  const channel = String(raw.channel || '').trim();
  const channelUrl = sanitizeVideoSuggestionWebUrl(raw.channelUrl);
  const uploadedAt = String(raw.uploadedAt || '').trim();
  const localPath = sanitizeVideoSuggestionHistoryPath(raw.localPath);
  if (thumbnailUrl) item.thumbnailUrl = thumbnailUrl.slice(0, 2000);
  if (channel) item.channel = channel.slice(0, 240);
  if (channelUrl) item.channelUrl = channelUrl;
  if (uploadedAt) item.uploadedAt = uploadedAt.slice(0, 40);
  if (
    typeof raw.durationSec === 'number' &&
    Number.isFinite(raw.durationSec) &&
    raw.durationSec > 0
  ) {
    item.durationSec = raw.durationSec;
  }
  if (localPath) item.localPath = localPath;
  return item;
}

function sanitizeHistory(items: unknown): VideoSuggestionDownloadHistoryItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map(sanitizeHistoryItem)
    .filter((item): item is VideoSuggestionDownloadHistoryItem => Boolean(item))
    .slice(0, MAX_HISTORY_ITEMS);
}

function historiesMatch(
  left: VideoSuggestionDownloadHistoryItem[],
  right: VideoSuggestionDownloadHistoryItem[]
): boolean {
  return (
    JSON.stringify(sanitizeHistory(left)) ===
    JSON.stringify(sanitizeHistory(right))
  );
}

function sanitizeDeletionIntent(
  value: unknown,
  isManagedLibraryPath: (filePath: string) => boolean
): PendingVideoSuggestionFileDeletionIntent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PendingVideoSuggestionFileDeletionIntent>;
  const operation = raw.operation;
  const itemId = String(raw.itemId || '').trim();
  const filePath = sanitizeVideoSuggestionHistoryPath(raw.filePath);
  if (
    raw.version !== 1 ||
    (operation !== 'delete-file' && operation !== 'delete-file-and-history') ||
    !itemId ||
    !filePath ||
    !normalizePath(filePath) ||
    !isManagedLibraryPath(filePath)
  ) {
    return null;
  }
  return { version: 1, operation, itemId, filePath };
}

function sanitizeDeletionIntents(
  values: unknown,
  isManagedLibraryPath: (filePath: string) => boolean
): PendingVideoSuggestionFileDeletionIntent[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const intents: PendingVideoSuggestionFileDeletionIntent[] = [];
  for (const value of values) {
    const intent = sanitizeDeletionIntent(value, isManagedLibraryPath);
    if (!intent) continue;
    const key = `${intent.operation}\u0000${intent.itemId}\u0000${normalizePath(intent.filePath)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    intents.push(intent);
    if (intents.length >= 8) break;
  }
  return intents;
}

function deletionIntentsMatch(
  left: PendingVideoSuggestionFileDeletionIntent[],
  right: PendingVideoSuggestionFileDeletionIntent[]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeHistoryItem(
  items: VideoSuggestionDownloadHistoryItem[],
  incomingValue: unknown
): {
  items: VideoSuggestionDownloadHistoryItem[];
  displaced: VideoSuggestionDownloadHistoryItem[];
} {
  const incoming = sanitizeHistoryItem(incomingValue);
  if (!incoming) return { items, displaced: [] };
  const incomingPath = normalizePath(incoming.localPath);
  const next = [incoming];
  const deduplicated: VideoSuggestionDownloadHistoryItem[] = [];
  for (const existing of items) {
    const existingPath = normalizePath(existing.localPath);
    if (incomingPath && existingPath === incomingPath) {
      deduplicated.push(existing);
      continue;
    }
    if (
      existing.sourceUrl === incoming.sourceUrl &&
      (!existingPath || !incomingPath)
    ) {
      deduplicated.push(existing);
      continue;
    }
    next.push(existing);
  }
  // Both deduplicated entries and entries cut by the size cap were displaced
  // by this insert. A stale-operation rollback must be able to recover all of
  // them, even though a successful upsert intentionally replaces the former.
  return {
    items: next.slice(0, MAX_HISTORY_ITEMS),
    displaced: [...deduplicated, ...next.slice(MAX_HISTORY_ITEMS)],
  };
}

export class VideoSuggestionDownloadHistoryManager {
  private readonly persistence: DownloadHistoryPersistence;
  private readonly isManagedLibraryPath: (filePath: string) => boolean;
  private readonly reclaimPaths: (filePaths: string[]) => Promise<string[]>;
  private readonly deleteManagedFile: (
    filePath: string
  ) => Promise<'deleted' | 'already_absent'>;
  private readonly onMaintenanceError?: (error: unknown) => void;
  private history: VideoSuggestionDownloadHistoryItem[] | null = null;
  private readonly commitGraceMs: number;
  private pendingReclaims = new Map<string, PendingReclaimEntry>();
  private pendingFileDeletions: PendingVideoSuggestionFileDeletionIntent[] = [];
  private mountedPathsByRenderer = new Map<number, Set<string>>();
  private displacedByUpsertId = new Map<
    string,
    VideoSuggestionDownloadHistoryItem[]
  >();
  private queue: Promise<void> = Promise.resolve();
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimerAt = 0;

  constructor(options: DownloadHistoryManagerOptions) {
    this.persistence = options.persistence;
    this.isManagedLibraryPath = options.isManagedLibraryPath;
    this.reclaimPaths = options.reclaimPaths;
    this.deleteManagedFile =
      options.deleteManagedFile ??
      (async filePath => {
        const reclaimed = await this.reclaimPaths([filePath]);
        const key = normalizePath(filePath);
        if (!reclaimed.some(candidate => normalizePath(candidate) === key)) {
          throw new Error('The managed download was not reclaimed.');
        }
        // Legacy/test reclaim callbacks do not distinguish an unlink from an
        // already-absent path. Production supplies the categorical callback.
        return 'deleted';
      });
    this.onMaintenanceError = options.onMaintenanceError;
    this.commitGraceMs = options.commitGraceMs ?? PROMOTED_FILE_COMMIT_GRACE_MS;
  }

  mutate(options: {
    rendererId: number;
    mutation: VideoSuggestionDownloadHistoryMutation;
    seedItems?: VideoSuggestionDownloadHistoryItem[];
    mountedPaths?: string[];
  }): Promise<VideoSuggestionDownloadHistoryItem[]> {
    return this.mutateDetailed(options).then(result => {
      if (!result.success) {
        throw new Error(
          result.error || 'Persistent download history could not be updated'
        );
      }
      return result.items;
    });
  }

  mutateDetailed(options: {
    rendererId: number;
    mutation: VideoSuggestionDownloadHistoryMutation;
    seedItems?: VideoSuggestionDownloadHistoryItem[];
    mountedPaths?: string[];
  }): Promise<VideoSuggestionDownloadHistoryMutationResult> {
    return this.serialized(async () => {
      this.ensureLoaded(options.seedItems);
      this.setMountedPathsInternal(
        options.rendererId,
        options.mountedPaths || []
      );
      const recovery = await this.recoverPendingFileDeletions();
      if (recovery && !recovery.success) return recovery;

      if (
        options.mutation.type === 'delete-file' ||
        options.mutation.type === 'delete-file-and-history'
      ) {
        return this.beginExplicitFileDeletion(options.mutation);
      }

      const previous = this.history!;
      const next = this.applyMutation(previous, options.mutation);
      if (this.rememberDroppedManagedPaths(previous, next, options.mutation)) {
        // Persist cleanup ownership before publishing the history mutation.
        // If history persistence then fails, the old history still protects
        // every queued path from reclamation.
        this.persistPendingReclaims();
      }
      this.persistence.saveHistory(next);
      this.history = next;
      await this.flushPendingReclaimsSafely();
      return {
        success: true,
        items: [...next],
        deletion: recovery?.deletion,
      };
    });
  }

  setMountedPaths(rendererId: number, filePaths: string[]): Promise<void> {
    return this.serialized(async () => {
      this.setMountedPathsInternal(rendererId, filePaths);
      if (this.history) {
        await this.recoverPendingFileDeletions();
        await this.flushPendingReclaimsSafely();
      }
    });
  }

  releaseRenderer(rendererId: number): Promise<void> {
    return this.serialized(async () => {
      this.mountedPathsByRenderer.delete(rendererId);
      if (this.history) {
        await this.recoverPendingFileDeletions();
        await this.flushPendingReclaimsSafely();
      }
    });
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private ensureLoaded(seedItems?: VideoSuggestionDownloadHistoryItem[]): void {
    if (this.history) return;
    const storedHistory = this.persistence.loadHistory();
    const history = Array.isArray(storedHistory)
      ? sanitizeHistory(storedHistory)
      : sanitizeHistory(seedItems);
    this.persistence.saveHistory(history);
    const pending = this.persistence.loadPendingReclaims();
    const loadedReclaims = new Map<string, PendingReclaimEntry>();
    for (const rawPath of Array.isArray(pending) ? pending : []) {
      const filePath = sanitizeVideoSuggestionHistoryPath(rawPath);
      const key = normalizePath(filePath);
      if (filePath && key && this.isManagedLibraryPath(filePath)) {
        // Restored entries belong to sessions that already ended; no commit
        // is in flight for them, so they carry no grace delay.
        loadedReclaims.set(key, { filePath, notBefore: 0 });
      }
    }
    const loadedFileDeletions = sanitizeDeletionIntents(
      this.persistence.loadPendingFileDeletions(),
      this.isManagedLibraryPath
    );
    // Commit only after every fallible load/save above has succeeded. A
    // transient persistence failure must leave the manager unloaded so the
    // next call retries, instead of marking it loaded with the persisted
    // reclaim queue silently dropped.
    this.history = history;
    this.pendingFileDeletions = loadedFileDeletions;
    for (const [key, entry] of loadedReclaims) {
      if (!this.pendingReclaims.has(key)) {
        this.pendingReclaims.set(key, entry);
      }
    }
  }

  trackPromotedFile(filePath: string): Promise<TrackedPromotedFileOwnership> {
    return this.serialized(async () => {
      this.ensureLoaded();
      // A promotion can reuse the basename of a file that an interrupted
      // explicit deletion already removed. Finish that durable intent while
      // the destination is still only a hidden partial, or fail the promotion
      // closed so recovery can never unlink a newly published replacement.
      const recovery = await this.recoverPendingFileDeletions();
      if (recovery && !recovery.success) {
        throw new Error(
          recovery.error || 'Pending file deletion could not be recovered'
        );
      }
      const sanitized = sanitizeVideoSuggestionHistoryPath(filePath);
      const key = normalizePath(sanitized);
      if (!sanitized || !key || !this.isManagedLibraryPath(sanitized)) {
        throw new Error('Promoted file is outside the managed library');
      }
      // The file is owned on disk from this moment: if the renderer dies
      // before its history upsert commits, a later flush (or the next
      // session's restore) reclaims it. The grace window keeps a concurrent
      // tab's flush from deleting it while the commit is still in flight.
      const notBefore = Date.now() + this.commitGraceMs;
      const ownerToken = randomUUID();
      const previous = this.pendingReclaims.get(key);
      this.pendingReclaims.set(key, {
        filePath: sanitized,
        notBefore,
        ownerToken,
      });
      try {
        this.persistPendingReclaims();
      } catch (error) {
        if (previous) this.pendingReclaims.set(key, previous);
        else this.pendingReclaims.delete(key);
        throw error;
      }
      // If the renderer dies without ever committing (or releasing a lease),
      // no mutation may arrive to flush this entry — make sure a flush runs
      // once the grace expires.
      this.scheduleGraceFlush(notBefore);
      return {
        rollback: () =>
          this.serialized(async () => {
            this.ensureLoaded();
            const current = this.pendingReclaims.get(key);
            if (current?.ownerToken !== ownerToken) return;
            if (previous) this.pendingReclaims.set(key, previous);
            else this.pendingReclaims.delete(key);
            try {
              this.persistPendingReclaims();
            } catch (error) {
              this.pendingReclaims.set(key, current);
              throw error;
            }
            if (previous && previous.notBefore > Date.now()) {
              this.scheduleGraceFlush(previous.notBefore);
            }
          }),
      };
    });
  }

  private scheduleGraceFlush(at: number): void {
    if (this.graceTimer && this.graceTimerAt <= at) return;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimerAt = at;
    const delay = Math.max(0, at - Date.now()) + 50;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      void this.serialized(async () => {
        if (this.history) await this.flushPendingReclaimsSafely();
      });
    }, delay);
    this.graceTimer.unref?.();
  }

  private applyMutation(
    items: VideoSuggestionDownloadHistoryItem[],
    mutation: VideoSuggestionDownloadHistoryMutation
  ): VideoSuggestionDownloadHistoryItem[] {
    switch (mutation.type) {
      case 'upsert': {
        const merged = mergeHistoryItem(items, mutation.item);
        const insertedId = String(
          (mutation.item as { id?: unknown } | null)?.id || ''
        ).trim();
        if (insertedId) {
          // Replace any older stash for the same ID. Reusing an ID for an
          // upsert that displaces nothing must not make a later rollback
          // resurrect entries from an unrelated mutation.
          this.displacedByUpsertId.delete(insertedId);
        }
        if (insertedId && merged.displaced.length > 0) {
          // Remember everything this insert displaced so a rollback of the
          // same upsert can restore the pre-upsert history instead of just
          // deleting the new entry.
          this.displacedByUpsertId.set(insertedId, merged.displaced);
          while (this.displacedByUpsertId.size > MAX_DISPLACED_STASH) {
            const oldest = this.displacedByUpsertId.keys().next().value;
            if (oldest === undefined) break;
            this.displacedByUpsertId.delete(oldest);
          }
        }
        return merged.items;
      }
      case 'remove': {
        const id = String(mutation.id || '').trim();
        return id ? items.filter(item => item.id !== id) : items;
      }
      case 'rollback-upsert': {
        const id = String(mutation.id || '').trim();
        if (!id) return items;
        const displaced = this.displacedByUpsertId.get(id) || [];
        this.displacedByUpsertId.delete(id);
        const next = items.filter(item => item.id !== id);
        const presentIds = new Set(next.map(item => item.id));
        const presentPaths = new Set(
          next.map(item => normalizePath(item.localPath)).filter(Boolean)
        );
        for (const item of displaced) {
          const key = normalizePath(item.localPath);
          if (presentIds.has(item.id) || (key && presentPaths.has(key))) {
            continue;
          }
          next.push(item);
        }
        return next.slice(0, MAX_HISTORY_ITEMS);
      }
      case 'replace-path': {
        const previousKey = normalizePath(mutation.previousPath);
        const savedPath = sanitizeVideoSuggestionHistoryPath(
          mutation.savedPath
        );
        if (!previousKey || !savedPath) return items;
        return items.map(item =>
          normalizePath(item.localPath) === previousKey
            ? { ...item, localPath: savedPath }
            : item
        );
      }
      default:
        return items;
    }
  }

  private async beginExplicitFileDeletion(
    mutation: Extract<
      VideoSuggestionDownloadHistoryMutation,
      { type: 'delete-file' | 'delete-file-and-history' }
    >
  ): Promise<VideoSuggestionDownloadHistoryMutationResult> {
    const operation = mutation.type;
    const itemId = String(mutation.id || '').trim();
    const expectedPath = sanitizeVideoSuggestionHistoryPath(
      mutation.expectedLocalPath
    );
    const expectedKey = normalizePath(expectedPath);
    const matchingIndexes = this.history!.map((item, index) =>
      item.id === itemId ? index : -1
    ).filter(index => index >= 0);
    const itemIndex = matchingIndexes[0] ?? -1;
    const filePath = sanitizeVideoSuggestionHistoryPath(
      this.history![itemIndex]?.localPath
    );
    const fileKey = normalizePath(filePath);
    const sharedPath = this.history!.some(
      (item, index) =>
        index !== itemIndex && normalizePath(item.localPath) === fileKey
    );

    if (
      !itemId ||
      matchingIndexes.length !== 1 ||
      !filePath ||
      !fileKey ||
      !expectedKey ||
      fileKey !== expectedKey ||
      !this.isManagedLibraryPath(filePath) ||
      sharedPath
    ) {
      return {
        success: false,
        items: [...this.history!],
        deletion: {
          operation,
          diskOutcome: 'deferred',
          historyOutcome: 'retained',
          deferredReason: 'history_conflict',
        },
        error: '__i18n__:input.videoSuggestion.deleteLocalFileUnavailable',
      };
    }

    if (this.isPathMounted(fileKey)) {
      return {
        success: false,
        items: [...this.history!],
        deletion: {
          operation,
          diskOutcome: 'deferred',
          historyOutcome: 'retained',
          deferredReason: 'mounted',
        },
        error: '__i18n__:input.videoSuggestion.deleteLocalFileInUse',
      };
    }

    const intent: PendingVideoSuggestionFileDeletionIntent = {
      version: 1,
      operation,
      itemId,
      filePath,
    };
    const nextIntents = [...this.pendingFileDeletions, intent];
    if (!this.persistFileDeletionIntentsVerified(nextIntents)) {
      return {
        success: false,
        items: [...this.history!],
        deletion: {
          operation,
          diskOutcome: 'deferred',
          historyOutcome: 'retained',
          deferredReason: 'intent_persistence_failed',
        },
        error: '__i18n__:input.videoSuggestion.deleteLocalFileFailed',
      };
    }
    this.pendingFileDeletions = nextIntents;
    return this.completeExplicitFileDeletion(intent, false);
  }

  private async recoverPendingFileDeletions(): Promise<
    VideoSuggestionDownloadHistoryMutationResult | undefined
  > {
    let latest: VideoSuggestionDownloadHistoryMutationResult | undefined;
    while (this.pendingFileDeletions.length > 0) {
      const intent = this.pendingFileDeletions[0]!;
      latest = await this.completeExplicitFileDeletion(intent, true);
      if (!latest.success) return latest;
    }
    return latest;
  }

  private inspectExplicitDeletionHistory(
    intent: PendingVideoSuggestionFileDeletionIntent
  ): ExplicitDeletionHistoryState {
    const key = normalizePath(intent.filePath);
    const matchingIndexes = this.history!.map((item, index) =>
      item.id === intent.itemId ? index : -1
    ).filter(index => index >= 0);
    if (!key || matchingIndexes.length > 1) return { state: 'conflict' };

    if (matchingIndexes.length === 0) {
      const shared = this.history!.some(
        item => normalizePath(item.localPath) === key
      );
      return intent.operation === 'delete-file-and-history' && !shared
        ? { state: 'committed' }
        : { state: 'conflict' };
    }

    const itemIndex = matchingIndexes[0]!;
    const itemPathKey = normalizePath(this.history![itemIndex]?.localPath);
    const shared = this.history!.some(
      (item, index) =>
        index !== itemIndex && normalizePath(item.localPath) === key
    );
    if (shared) return { state: 'conflict' };
    if (itemPathKey === key) return { state: 'pending', itemIndex };
    if (intent.operation === 'delete-file' && !itemPathKey) {
      return { state: 'committed' };
    }
    return { state: 'conflict' };
  }

  private async completeExplicitFileDeletion(
    intent: PendingVideoSuggestionFileDeletionIntent,
    recovered: boolean
  ): Promise<VideoSuggestionDownloadHistoryMutationResult> {
    const operation = intent.operation;
    const key = normalizePath(intent.filePath);
    const historyState = this.inspectExplicitDeletionHistory(intent);
    if (historyState.state === 'conflict') {
      return {
        success: false,
        items: [...this.history!],
        deletion: {
          operation,
          diskOutcome: 'deferred',
          historyOutcome: 'pending',
          deferredReason: 'history_conflict',
          recovered,
        },
        error: '__i18n__:input.videoSuggestion.deleteLocalFileUnavailable',
      };
    }
    if (this.isPathMounted(key)) {
      return {
        success: false,
        items: [...this.history!],
        deletion: {
          operation,
          diskOutcome: 'deferred',
          historyOutcome: 'pending',
          deferredReason: 'mounted',
          recovered,
        },
        error: '__i18n__:input.videoSuggestion.deleteLocalFileInUse',
      };
    }

    let diskOutcome: ExplicitDeletionOutcome['diskOutcome'];
    try {
      diskOutcome = await this.deleteManagedFile(intent.filePath);
    } catch (error) {
      this.onMaintenanceError?.(error);
      return {
        success: false,
        items: [...this.history!],
        deletion: {
          operation,
          diskOutcome: 'failed',
          historyOutcome: 'pending',
          deferredReason: 'disk_reclaim_failed',
          recovered,
        },
        error: '__i18n__:input.videoSuggestion.deleteLocalFileFailed',
      };
    }

    if (historyState.state === 'pending') {
      const next = [...this.history!];
      if (operation === 'delete-file') {
        const retainedItem = { ...next[historyState.itemIndex]! };
        delete retainedItem.localPath;
        next[historyState.itemIndex] = retainedItem;
      } else {
        next.splice(historyState.itemIndex, 1);
      }
      if (!this.persistHistoryVerified(next)) {
        return {
          success: false,
          items: [...this.history!],
          deletion: {
            operation,
            diskOutcome,
            historyOutcome: 'pending',
            deferredReason: 'history_persistence_failed',
            recovered,
          },
          error: '__i18n__:input.videoSuggestion.deleteLocalFileHistoryPending',
        };
      }
      this.history = next;
    }

    if (this.pendingReclaims.delete(key)) {
      try {
        this.persistPendingReclaims();
      } catch (error) {
        // A stale cleanup claim can safely retry: the explicit deletion is
        // idempotent, and the history boundary is already committed.
        this.onMaintenanceError?.(error);
      }
    }

    const nextIntents = this.pendingFileDeletions.filter(
      candidate => candidate !== intent
    );
    if (!this.persistFileDeletionIntentsVerified(nextIntents)) {
      return {
        success: false,
        items: [...this.history!],
        deletion: {
          operation,
          diskOutcome,
          historyOutcome: operation === 'delete-file' ? 'retained' : 'removed',
          deferredReason: 'intent_cleanup_failed',
          recovered,
        },
        error: '__i18n__:input.videoSuggestion.deleteLocalFileHistoryPending',
      };
    }
    this.pendingFileDeletions = nextIntents;

    return {
      success: true,
      items: [...this.history!],
      deletion: {
        operation,
        diskOutcome,
        historyOutcome: operation === 'delete-file' ? 'retained' : 'removed',
        recovered,
      },
    };
  }

  private persistHistoryVerified(
    next: VideoSuggestionDownloadHistoryItem[]
  ): boolean {
    let failure: unknown;
    try {
      this.persistence.saveHistory(next);
    } catch (error) {
      failure = error;
    }
    try {
      const stored = sanitizeHistory(this.persistence.loadHistory());
      if (historiesMatch(stored, next)) {
        if (failure) this.onMaintenanceError?.(failure);
        return true;
      }
    } catch (error) {
      failure = failure || error;
    }
    this.onMaintenanceError?.(
      failure || new Error('Download history persistence did not round-trip.')
    );
    return false;
  }

  private persistFileDeletionIntentsVerified(
    next: PendingVideoSuggestionFileDeletionIntent[]
  ): boolean {
    let failure: unknown;
    try {
      this.persistence.savePendingFileDeletions(next);
    } catch (error) {
      failure = error;
    }
    try {
      const stored = sanitizeDeletionIntents(
        this.persistence.loadPendingFileDeletions(),
        this.isManagedLibraryPath
      );
      if (deletionIntentsMatch(stored, next)) {
        if (failure) this.onMaintenanceError?.(failure);
        return true;
      }
    } catch (error) {
      failure = failure || error;
    }
    this.onMaintenanceError?.(
      failure || new Error('File deletion intent did not round-trip.')
    );
    return false;
  }

  private isPathMounted(key: string): boolean {
    for (const mountedPaths of this.mountedPathsByRenderer.values()) {
      if (mountedPaths.has(key)) return true;
    }
    return false;
  }

  private setMountedPathsInternal(
    rendererId: number,
    filePaths: string[]
  ): void {
    const paths = new Set(
      (Array.isArray(filePaths) ? filePaths : [])
        .map(normalizePath)
        .filter(Boolean)
    );
    if (paths.size > 0) this.mountedPathsByRenderer.set(rendererId, paths);
    else this.mountedPathsByRenderer.delete(rendererId);
  }

  private rememberDroppedManagedPaths(
    previous: VideoSuggestionDownloadHistoryItem[],
    next: VideoSuggestionDownloadHistoryItem[],
    mutation: VideoSuggestionDownloadHistoryMutation
  ): boolean {
    // Explicit file deletion already synchronously reclaimed the exact
    // authoritative path before the history item was detached from it.
    if (
      mutation.type === 'delete-file' ||
      mutation.type === 'delete-file-and-history'
    ) {
      return false;
    }

    let changed = false;
    const retained = new Set(
      next.map(item => normalizePath(item.localPath)).filter(Boolean)
    );
    // Paths dropped by an upsert may be restored if that upsert is rolled
    // back (stale operation) — reclaim them only after the commit grace so
    // the rollback finds the files intact. Explicit removals reclaim now.
    const droppedNotBefore =
      mutation.type === 'upsert' ? Date.now() + this.commitGraceMs : 0;
    for (const item of previous) {
      const filePath = sanitizeVideoSuggestionHistoryPath(item.localPath);
      const key = normalizePath(filePath);
      if (
        filePath &&
        key &&
        !retained.has(key) &&
        this.isManagedLibraryPath(filePath)
      ) {
        if (!this.pendingReclaims.has(key)) {
          this.pendingReclaims.set(key, {
            filePath,
            notBefore: droppedNotBefore,
          });
          changed = true;
        }
      }
    }
    if (mutation.type === 'remove' || mutation.type === 'rollback-upsert') {
      const fallbackPath = sanitizeVideoSuggestionHistoryPath(
        mutation.reclaimPath
      );
      const fallbackKey = normalizePath(fallbackPath);
      if (
        fallbackPath &&
        fallbackKey &&
        !retained.has(fallbackKey) &&
        this.isManagedLibraryPath(fallbackPath) &&
        !this.pendingReclaims.has(fallbackKey)
      ) {
        this.pendingReclaims.set(fallbackKey, {
          filePath: fallbackPath,
          notBefore: 0,
        });
        changed = true;
      }
    }
    return changed;
  }

  private async flushPendingReclaimsSafely(): Promise<void> {
    try {
      await this.flushPendingReclaims();
    } catch (error) {
      // History is already durably committed at this point. Cleanup is
      // maintenance and must never make the renderer believe that ownership
      // failed; pending paths remain persisted for a later retry.
      this.onMaintenanceError?.(error);
    }
  }

  private async flushPendingReclaims(): Promise<void> {
    if (this.pendingReclaims.size === 0) return;
    const owned = new Set(
      this.history!.map(item => normalizePath(item.localPath)).filter(Boolean)
    );
    // Once a tracked path is committed into history, the history entry owns
    // it — drop the reclaim claim so it cannot outlive a later removal's own
    // bookkeeping (which re-queues the path without a grace delay).
    let droppedOwned = false;
    for (const key of Array.from(this.pendingReclaims.keys())) {
      if (owned.has(key)) {
        this.pendingReclaims.delete(key);
        droppedOwned = true;
      }
    }
    const mounted = new Set<string>();
    for (const paths of this.mountedPathsByRenderer.values()) {
      for (const key of paths) mounted.add(key);
    }
    const now = Date.now();
    const eligible: Array<[string, PendingReclaimEntry]> = [];
    let earliestDeferred = Infinity;
    for (const [key, entry] of this.pendingReclaims.entries()) {
      if (mounted.has(key)) continue;
      if (entry.notBefore <= now) eligible.push([key, entry]);
      else earliestDeferred = Math.min(earliestDeferred, entry.notBefore);
    }
    // Entries skipped only because their commit grace has not expired must
    // not depend on a future mutation to be revisited.
    if (Number.isFinite(earliestDeferred)) {
      this.scheduleGraceFlush(earliestDeferred);
    }
    if (eligible.length === 0) {
      if (droppedOwned) this.persistPendingReclaims();
      return;
    }

    const reclaimed = await this.reclaimPaths(
      eligible.map(([, entry]) => entry.filePath)
    );
    const reclaimedKeys = new Set(reclaimed.map(normalizePath).filter(Boolean));
    for (const key of reclaimedKeys) this.pendingReclaims.delete(key);
    this.persistPendingReclaims();
  }

  private persistPendingReclaims(): void {
    this.persistence.savePendingReclaims(
      Array.from(this.pendingReclaims.values(), entry => entry.filePath)
    );
  }
}

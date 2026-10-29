import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { VideoSuggestionDownloadHistoryItem } from '@shared-types/app';
import { validDownloadFolderId } from '../../shared/helpers/download-history.js';
import { withLock } from './async-lock.js';
import {
  encryptPrivateFile,
  readPrivateFileRange,
  sealPrivateJson,
  openPrivateJson,
  wrapPrivateKey,
  unlockPrivateKey,
  PrivateLibraryError,
  type WrappedPrivateKey,
} from './private-library-crypto.js';

export type DownloadFolder = {
  id: string;
  name?: string;
  private: boolean;
  locked: boolean;
  count?: number;
  pending?: boolean;
};
export type PrivateAsset = {
  id: string;
  sourcePath: string;
  size: number;
  identity?: string;
  kind: 'video' | 'subtitle' | 'data';
  label?: string;
  mime?: string;
};
export type PrivateTransferPlan = {
  files: Omit<PrivateAsset, 'id' | 'size'>[];
  indexes: { path: string; key: string; records: Record<string, any>[] }[];
};
export type PrivateEntry = {
  id: string;
  item: VideoSuggestionDownloadHistoryItem;
  assets: PrivateAsset[];
  plan: PrivateTransferPlan;
  ready: boolean;
};
type Manifest = {
  version: 1;
  name: string;
  entries: { id: string; title: string; ready: boolean; historyId: string }[];
};
type FolderRecord = { id: string; name?: string; key?: WrappedPrivateKey };
type FolderSession = {
  key: Buffer;
  owner: number;
  manifest: Manifest;
  controller: AbortController;
  touched: number;
};

/** Small atomic durable writes. No plaintext metadata ever enters temporary files. */
export async function writePrivateAtomic(
  filePath: string,
  bytes: Buffer | string
): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.pending`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, filePath);
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}

export class DownloadFolders {
  private sessions = new Map<string, FolderSession>();
  private lockEpoch = 0;
  private ownerEpochs = new Map<number, number>();
  private folderEpochs = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;
  constructor(
    readonly root: string,
    private onLock: (folderId: string) => void = () => {}
  ) {
    this.timer = setInterval(() => {
      for (const [id, session] of this.sessions)
        if (Date.now() - session.touched > 15 * 60_000) this.lock(id);
    }, 30_000);
    this.timer.unref?.();
  }
  dispose(): void {
    clearInterval(this.timer);
    this.lockAll();
  }
  lock(id: string): void {
    this.folderEpochs.set(id, (this.folderEpochs.get(id) || 0) + 1);
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    session.controller.abort();
    session.key.fill(0);
    session.manifest.entries.length = 0;
    session.manifest.name = '';
    this.onLock(id);
  }
  lockForOwner(id: string, owner: number): void {
    this.ownerEpochs.set(owner, (this.ownerEpochs.get(owner) || 0) + 1);
    if (this.sessions.get(id)?.owner === owner) this.lock(id);
  }
  touch(id: string, owner: number): void {
    this.getSession(id, owner);
  }
  lockOwner(owner: number): void {
    this.ownerEpochs.set(owner, (this.ownerEpochs.get(owner) || 0) + 1);
    for (const [id, s] of this.sessions) if (s.owner === owner) this.lock(id);
  }
  lockAll(): void {
    this.lockEpoch++;
    for (const id of this.sessions.keys()) this.lock(id);
  }
  interactionGuard(owner: number, id = ''): () => void {
    const all = this.lockEpoch;
    const own = this.ownerEpochs.get(owner);
    const folder = this.folderEpochs.get(id);
    return () => {
      if (
        all !== this.lockEpoch ||
        own !== this.ownerEpochs.get(owner) ||
        folder !== this.folderEpochs.get(id)
      ) {
        throw new PrivateLibraryError('locked');
      }
    };
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    return withLock(`private-library:${this.root}`, fn);
  }
  private folderPath(id: string): string {
    if (!validDownloadFolderId(id)) throw new PrivateLibraryError('not_found');
    return path.join(this.root, id);
  }
  private entryPath(folderId: string, entryId: string): string {
    if (!validDownloadFolderId(entryId))
      throw new PrivateLibraryError('not_found');
    return path.join(this.folderPath(folderId), entryId);
  }
  private getSession(id: string, owner: number): FolderSession {
    const session = this.sessions.get(id);
    if (
      !session ||
      session.owner !== owner ||
      session.controller.signal.aborted
    )
      throw new PrivateLibraryError('locked');
    session.touched = Date.now();
    return session;
  }
  private async records(): Promise<FolderRecord[]> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(
        await fs.readFile(path.join(this.root, 'folders.json'), 'utf8')
      );
      if (
        parsed.version !== 1 ||
        !Array.isArray(parsed.folders) ||
        parsed.folders.length > 100 ||
        parsed.folders.some(
          (f: FolderRecord) =>
            !validDownloadFolderId(f.id) ||
            (!f.key && typeof f.name !== 'string')
        )
      )
        throw new PrivateLibraryError('corrupt');
      return parsed.folders;
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  private saveRecords(folders: FolderRecord[]): Promise<void> {
    return writePrivateAtomic(
      path.join(this.root, 'folders.json'),
      JSON.stringify({ version: 1, folders })
    );
  }
  private async saveManifest(
    id: string,
    session: FolderSession,
    manifest: Manifest,
    committed?: () => void
  ): Promise<void> {
    session.controller.signal.throwIfAborted();
    await writePrivateAtomic(
      path.join(this.folderPath(id), 'manifest.enc'),
      sealPrivateJson(session.key, manifest, `manifest:${id}`)
    );
    // Publication is durable even if a lock wins before this continuation.
    // The caller must never remove files now referenced by this manifest.
    committed?.();
    session.controller.signal.throwIfAborted();
    session.manifest = manifest;
  }
  async list(owner: number): Promise<DownloadFolder[]> {
    return this.serial(async () =>
      (await this.records()).map(record => {
        const s = this.sessions.get(record.id);
        const own = s?.owner === owner;
        return {
          id: record.id,
          name: record.key ? (own ? s.manifest.name : undefined) : record.name,
          private: !!record.key,
          locked: !!record.key && !own,
          ...(own
            ? {
                count: s.manifest.entries.length,
                pending: s.manifest.entries.some(e => !e.ready),
              }
            : {}),
        };
      })
    );
  }
  async create(
    owner: number,
    name: string,
    password?: string
  ): Promise<string> {
    const id = randomUUID();
    const assertUnlocked = this.interactionGuard(owner, id);
    return this.serial(async () => {
      name = this.cleanName(name);
      const records = await this.records();
      if (records.length >= 100) throw new PrivateLibraryError('full');
      const record: FolderRecord = { id };
      if (password !== undefined) {
        const { key, config } = await wrapPrivateKey(id, password);
        const session: FolderSession = {
          key,
          owner,
          manifest: { version: 1, name, entries: [] },
          controller: new AbortController(),
          touched: Date.now(),
        };
        let published = false;
        try {
          assertUnlocked();
          await fs.mkdir(this.folderPath(id), { mode: 0o700 });
          record.key = config;
          await this.saveManifest(id, session, session.manifest);
          await this.saveRecords([...records, record]);
          published = true;
          assertUnlocked();
          this.sessions.set(id, session);
        } catch (error) {
          key.fill(0);
          if (!published)
            await fs.rm(this.folderPath(id), { recursive: true, force: true });
          throw error;
        }
      } else {
        record.name = name;
        await this.saveRecords([...records, record]);
      }
      return id;
    });
  }
  async unlock(owner: number, id: string, password: string): Promise<void> {
    const assertUnlocked = this.interactionGuard(owner, id);
    return this.serial(async () => {
      const record = (await this.records()).find(f => f.id === id);
      if (!record?.key) throw new PrivateLibraryError('not_found');
      // Derive before touching any existing session: a failed password must not lock another tab.
      const key = await unlockPrivateKey(id, password, record.key);
      try {
        const manifest = openPrivateJson<Manifest>(
          key,
          await fs.readFile(path.join(this.folderPath(id), 'manifest.enc')),
          `manifest:${id}`
        );
        if (
          manifest.version !== 1 ||
          typeof manifest.name !== 'string' ||
          !Array.isArray(manifest.entries) ||
          manifest.entries.length > 5000 ||
          manifest.entries.some(e => !validDownloadFolderId(e.id))
        )
          throw new PrivateLibraryError('corrupt');
        assertUnlocked();
        this.lock(id);
        this.sessions.set(id, {
          key,
          owner,
          manifest,
          controller: new AbortController(),
          touched: Date.now(),
        });
      } catch (error) {
        key.fill(0);
        throw error;
      }
    });
  }
  async rename(owner: number, id: string, name: string): Promise<void> {
    return this.serial(async () => {
      name = this.cleanName(name);
      const records = await this.records();
      const record = records.find(f => f.id === id);
      if (!record) throw new PrivateLibraryError('not_found');
      if (record.key) {
        const s = this.getSession(id, owner);
        await this.saveManifest(id, s, { ...s.manifest, name });
      } else {
        record.name = name;
        await this.saveRecords(records);
      }
    });
  }
  async removeFolder(owner: number, id: string): Promise<void> {
    return this.serial(async () => {
      const records = await this.records();
      const record = records.find(f => f.id === id);
      if (!record) throw new PrivateLibraryError('not_found');
      if (record.key && this.getSession(id, owner).manifest.entries.length)
        throw new PrivateLibraryError('not_empty');
      await this.saveRecords(records.filter(f => f.id !== id));
      this.lock(id);
      await fs.rm(this.folderPath(id), { recursive: true, force: true });
    });
  }
  private cleanName(name: unknown): string {
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.trim().length > 80 ||
      [...name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    )
      throw new PrivateLibraryError('invalid_name');
    return name.trim();
  }
  async entries(
    owner: number,
    id: string
  ): Promise<{ id: string; title: string; ready: boolean }[]> {
    return this.serial(async () =>
      this.getSession(id, owner).manifest.entries.map(
        ({ id, title, ready }) => ({ id, title, ready })
      )
    );
  }
  async entry(
    owner: number,
    folderId: string,
    entryId: string
  ): Promise<PrivateEntry> {
    const s = this.getSession(folderId, owner);
    if (!s.manifest.entries.some(e => e.id === entryId))
      throw new PrivateLibraryError('not_found');
    const entry = openPrivateJson<PrivateEntry>(
      s.key,
      await fs.readFile(
        path.join(this.entryPath(folderId, entryId), 'entry.enc')
      ),
      `entry:${folderId}:${entryId}`
    );
    s.controller.signal.throwIfAborted();
    if (
      entry.id !== entryId ||
      !Array.isArray(entry.assets) ||
      entry.assets.some(a => !validDownloadFolderId(a.id))
    )
      throw new PrivateLibraryError('corrupt');
    return entry;
  }
  /** Commit encrypted content before deleting any source. A crash during cleanup
   * leaves an explicitly pending entry; unlocking and retrying completes it. */
  async import(
    owner: number,
    folderId: string,
    item: VideoSuggestionDownloadHistoryItem,
    plan: PrivateTransferPlan,
    cleanup: (entry: PrivateEntry) => Promise<void>
  ): Promise<void> {
    return this.serial(async () => {
      const s = this.getSession(folderId, owner);
      const pending = s.manifest.entries.find(e => e.historyId === item.id);
      if (pending) {
        await this.finishImport(owner, folderId, pending.id, cleanup);
        return;
      }
      if (s.manifest.entries.length >= 5000)
        throw new PrivateLibraryError('full');
      const id = randomUUID();
      const dir = this.entryPath(folderId, id);
      const entry: PrivateEntry = { id, item, assets: [], plan, ready: false };
      let published = false;
      await fs.mkdir(dir, { mode: 0o700 });
      try {
        for (const file of plan.files) {
          const assetId = randomUUID();
          const target = path.join(dir, `${assetId}.enc`);
          const { size } = await encryptPrivateFile(
            file.sourcePath,
            target,
            s.key,
            s.controller.signal
          );
          // Authenticate every byte before the source becomes eligible for removal.
          for await (const chunk of readPrivateFileRange({
            filePath: target,
            key: s.key,
            size,
            signal: s.controller.signal,
          }))
            chunk.fill(0);
          entry.assets.push({ ...file, id: assetId, size });
        }
        if (!entry.assets.some(a => a.kind === 'video'))
          throw new PrivateLibraryError('managed_only');
        await writePrivateAtomic(
          path.join(dir, 'entry.enc'),
          sealPrivateJson(s.key, entry, `entry:${folderId}:${id}`)
        );
        await this.saveManifest(
          folderId,
          s,
          {
            ...s.manifest,
            entries: [
              ...s.manifest.entries,
              { id, title: item.title, ready: false, historyId: item.id },
            ],
          },
          () => {
            published = true;
          }
        );
        await this.finishImport(owner, folderId, id, cleanup);
      } finally {
        if (!published) await fs.rm(dir, { recursive: true, force: true });
      }
    });
  }
  private async finishImport(
    owner: number,
    folderId: string,
    id: string,
    cleanup: (entry: PrivateEntry) => Promise<void>
  ): Promise<void> {
    const s = this.getSession(folderId, owner);
    const entry = await this.entry(owner, folderId, id);
    if (entry.ready) {
      await this.saveManifest(folderId, s, {
        ...s.manifest,
        entries: s.manifest.entries.map(e =>
          e.id === id ? { ...e, ready: true } : e
        ),
      });
      return;
    }
    s.controller.signal.throwIfAborted();
    await cleanup(entry);
    // Cleanup may take time, and lock must win over a late completion.
    s.controller.signal.throwIfAborted();
    entry.ready = true;
    await writePrivateAtomic(
      path.join(this.entryPath(folderId, id), 'entry.enc'),
      sealPrivateJson(s.key, entry, `entry:${folderId}:${id}`)
    );
    await this.saveManifest(folderId, s, {
      ...s.manifest,
      entries: s.manifest.entries.map(e =>
        e.id === id ? { ...e, ready: true } : e
      ),
    });
  }
  async retryPending(
    owner: number,
    folderId: string,
    cleanup: (entry: PrivateEntry) => Promise<void>
  ): Promise<void> {
    return this.serial(async () => {
      for (const e of [...this.getSession(folderId, owner).manifest.entries])
        if (!e.ready) await this.finishImport(owner, folderId, e.id, cleanup);
    });
  }
  async removeEntry(
    owner: number,
    folderId: string,
    id: string
  ): Promise<void> {
    return this.serial(async () => {
      const s = this.getSession(folderId, owner);
      const e = s.manifest.entries.find(e => e.id === id);
      if (!e?.ready) throw new PrivateLibraryError('pending');
      await this.saveManifest(folderId, s, {
        ...s.manifest,
        entries: s.manifest.entries.filter(e => e.id !== id),
      });
      this.onLock(folderId); // Close viewers before removing the asset.
      await fs.rm(this.entryPath(folderId, id), {
        recursive: true,
        force: true,
      });
    });
  }
  async media(
    owner: number,
    folderId: string,
    id: string,
    assetId: string,
    start?: number,
    end?: number,
    recovery = false
  ): Promise<{
    size: number;
    mime: string;
    stream: AsyncGenerator<Buffer>;
    signal: AbortSignal;
  }> {
    const s = this.getSession(folderId, owner);
    const entry = await this.entry(owner, folderId, id);
    // Only the explicit recovery-copy path may read a pending transfer.
    // Normal playback remains unavailable until public copies are cleaned up.
    if (!entry.ready && !recovery) throw new PrivateLibraryError('pending');
    const asset = entry.assets.find(a => a.id === assetId);
    if (!asset) throw new PrivateLibraryError('not_found');
    return {
      size: asset.size,
      mime: asset.mime || 'application/octet-stream',
      signal: s.controller.signal,
      stream: readPrivateFileRange({
        filePath: path.join(this.entryPath(folderId, id), `${assetId}.enc`),
        key: s.key,
        size: asset.size,
        start,
        end,
        signal: s.controller.signal,
      }),
    };
  }
}

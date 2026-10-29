import {
  app,
  BrowserWindow,
  dialog,
  powerMonitor,
  ipcMain,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DownloadFolders,
  type PrivateEntry,
} from '../services/private-library.js';
import {
  collectPrivateAssets,
  cleanPrivateAssets,
  withPrivateAssetLocks,
} from '../services/private-library-assets.js';
import {
  closePrivateViewers,
  openPrivateViewer,
} from '../services/private-library-viewer.js';
import { getDownloadHistoryManager } from './url-handlers.js';
import {
  getAllTabWebContents,
  getTabForWebContents,
  hasTabsNeedingCloseGuard,
} from '../tab-manager.js';
import { withLock } from '../services/async-lock.js';
import { exportPrivateEntry } from '../services/private-library-export.js';
import { settingsStore } from '../store/settings-store.js';
import { purgeRunningSubtitleJobs } from '../services/running-subtitle-jobs.js';
import type {
  DownloadFolderRequest,
  DownloadFolderResult,
} from '@shared-types/app';

let folders: DownloadFolders | undefined;
const owners = new Set<number>();
const allowedErrors = new Set([
  'not_found',
  'managed_only',
  'in_use',
  'full',
  'locked',
  'not_empty',
  'invalid_name',
  'password_length',
  'incorrect_password',
  'corrupt',
  'source_changed',
  'pending',
  'unsupported_file',
]);
function broadcast(): void {
  for (const wc of getAllTabWebContents()) {
    if (!wc.isDestroyed()) wc.send('download-folders:changed');
  }
}
function store(): DownloadFolders {
  if (!folders) {
    folders = new DownloadFolders(
      path.join(app.getPath('userData'), 'private-library'),
      id => {
        closePrivateViewers(id);
        broadcast();
      }
    );
    app.once('before-quit', () => folders?.dispose());
    void app.whenReady().then(() => {
      powerMonitor.on('lock-screen', () => folders?.lockAll());
      powerMonitor.on('suspend', () => folders?.lockAll());
    });
  }
  return folders;
}
function registerOwner(event: IpcMainInvokeEvent): void {
  if (
    !getTabForWebContents(event.sender) ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new Error('untrusted');
  if (!owners.has(event.sender.id)) {
    owners.add(event.sender.id);
    event.sender.once('destroyed', () => {
      folders?.lockOwner(event.sender.id);
      owners.delete(event.sender.id);
    });
  }
}
async function purgeCaches(entry: PrivateEntry): Promise<void> {
  const positions = settingsStore.get('videoPlaybackPositions', {}) as Record<
    string,
    number
  >;
  if (entry.item.localPath) delete positions[entry.item.localPath];
  settingsStore.set('videoPlaybackPositions', positions);
  const payload = {
    id: entry.item.id,
    paths: entry.assets.map(a => a.sourcePath),
    sourceUrl: entry.item.sourceUrl,
  };
  purgeRunningSubtitleJobs(
    [...payload.paths, payload.sourceUrl].filter(Boolean)
  );
  // Await each live tab's purge. A vanished/crashed tab cannot retain live state;
  // canonical history plus tombstones prevents its disk cache resurrecting it.
  await Promise.all(
    getAllTabWebContents().map(
      wc =>
        new Promise<void>((resolve, reject) => {
          const channel = `download-folders:purged:${wc.id}`;
          const nonce = randomUUID();
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error('storage_failed'));
          }, 5000);
          const done = (event: Electron.IpcMainEvent, reply: string) => {
            if (event.sender.id === wc.id && reply === nonce) {
              cleanup();
              resolve();
            }
          };
          const destroyed = () => {
            cleanup();
            resolve();
          };
          const cleanup = () => {
            clearTimeout(timer);
            ipcMain.removeListener(channel, done);
            wc.removeListener('destroyed', destroyed);
          };
          ipcMain.on(channel, done);
          wc.once('destroyed', destroyed);
          wc.send('download-folders:purge', {
            ...payload,
            nonce,
            ackChannel: channel,
          });
        })
    )
  );
}
async function handleDownloadFolderSerial(
  event: IpcMainInvokeEvent,
  request: DownloadFolderRequest
): Promise<DownloadFolderResult> {
  try {
    registerOwner(event);
    const service = store();
    const owner = event.sender.id;
    const manager = getDownloadHistoryManager();
    if (!request || typeof request !== 'object') throw new Error('not_found');
    if (request.action === 'lock') {
      service.lockForOwner(request.folderId, owner);
      return { success: true };
    }
    const all = await service.list(owner);
    const id = 'folderId' in request ? request.folderId : '';
    const folder = all.find(f => f.id === id);
    switch (request.action) {
      case 'list':
        return { success: true, folders: all };
      case 'create': {
        if (request.private && typeof request.password !== 'string')
          throw new Error('password_length');
        const folderId = await service.create(
          owner,
          request.name,
          request.private ? request.password : undefined
        );
        broadcast();
        return { success: true, folderId };
      }
      case 'rename':
        await service.rename(owner, id, request.name);
        break;
      case 'delete-folder':
        if (await manager.hasFolderItems(id)) throw new Error('not_empty');
        await service.removeFolder(owner, id);
        break;
      case 'unlock': {
        await service.unlock(owner, id, request.password);
        await service.retryPending(owner, id, entry =>
          manager.transferToPrivate(
            entry.item.id,
            (_item, remove) =>
              withPrivateAssetLocks(async () => {
                await cleanPrivateAssets(
                  app.getPath('userData'),
                  entry,
                  remove
                );
                await purgeCaches(entry);
              }),
            entry.item
          )
        );
        break;
      }
      case 'entries':
        return { success: true, entries: await service.entries(owner, id) };
      case 'open':
        if (
          !request.labels ||
          Object.values(request.labels).some(
            s => typeof s !== 'string' || s.length > 160
          )
        )
          throw new Error('not_found');
        await openPrivateViewer(
          service,
          event.sender,
          id,
          request.entryId,
          request.labels
        );
        break;
      case 'delete-entry':
        await service.removeEntry(owner, id, request.entryId);
        break;
      case 'export': {
        await service.entry(owner, id, request.entryId);
        if (typeof request.title !== 'string' || request.title.length > 160)
          throw new Error('not_found');
        const options: Electron.OpenDialogOptions = {
          title: request.title,
          properties: ['openDirectory', 'createDirectory'],
        };
        const parent = BrowserWindow.fromWebContents(event.sender);
        const selected = parent
          ? await dialog.showOpenDialog(parent, options)
          : await dialog.showOpenDialog(options);
        if (selected.canceled || !selected.filePaths[0])
          return { success: true };
        if (event.sender.isDestroyed()) throw new Error('locked');
        await exportPrivateEntry(
          service,
          owner,
          id,
          request.entryId,
          selected.filePaths[0]
        );
        break;
      }
      case 'move': {
        if (id && !folder) throw new Error('not_found');
        if (!folder?.private) {
          await manager.assignFolder(request.itemId, id || undefined);
          break;
        }
        if (hasTabsNeedingCloseGuard()) throw new Error('in_use');
        await manager.transferToPrivate(
          request.itemId,
          async (item, remove) => {
            const plan = await withPrivateAssetLocks(() =>
              collectPrivateAssets(app.getPath('userData'), item)
            );
            await service.import(owner, id, item, plan, entry =>
              withPrivateAssetLocks(async () => {
                await cleanPrivateAssets(
                  app.getPath('userData'),
                  entry,
                  remove
                );
                await purgeCaches(entry);
              })
            );
          }
        );
        break;
      }
      default:
        throw new Error('not_found');
    }
    broadcast();
    return { success: true };
  } catch (error: any) {
    // A failed cleanup may still have published a recoverable encrypted entry.
    broadcast();
    return {
      success: false,
      error: allowedErrors.has(error?.message)
        ? error.message
        : 'storage_failed',
    };
  } finally {
    // A tab can close while scrypt or disk I/O is still in flight.
    if (event.sender.isDestroyed()) folders?.lockOwner(event.sender.id);
  }
}

export async function handleDownloadFolder(
  event: IpcMainInvokeEvent,
  request: DownloadFolderRequest
): Promise<DownloadFolderResult> {
  if (request?.action === 'lock')
    return handleDownloadFolderSerial(event, request);
  try {
    registerOwner(event);
    const guard = store().interactionGuard(
      event.sender.id,
      request && 'folderId' in request ? request.folderId : ''
    );
    return await withLock('download-folder-requests', () => {
      if (
        request?.action === 'unlock' ||
        (request?.action === 'create' && request.private)
      )
        guard();
      return handleDownloadFolderSerial(event, request);
    });
  } catch {
    return { success: false, error: 'locked' };
  }
}

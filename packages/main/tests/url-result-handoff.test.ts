import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  cleanupInterruptedUrlDownloadPromotions,
  cleanupLegacyUrlDownloadScratchDir,
  getUrlDownloadLibraryDir,
  getUrlDownloadPromotionPartialDir,
  getUrlDownloadScratchDir,
  promoteUrlDownload,
  reclaimUrlDownloadLibraryFiles,
  URL_DOWNLOAD_PROMOTION_PARTIAL_DIRNAME,
} from '../services/url-download-library.js';
import { claimPendingUrlResultFilePath } from '../utils/url-result-claim.js';
import { isIpcInvokeSenderGone } from '../utils/ipc-sender-liveness.js';

async function withTempDir<T>(fn: (rootDir: string) => Promise<T>): Promise<T> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'stage5-url-result-handoff-')
  );
  try {
    return await fn(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

test('accepted URL downloads survive scratch-directory cleanup', async () => {
  await withTempDir(async rootDir => {
    const scratchDir = path.join(rootDir, 'translator-electron-dev-work');
    const userDataDir = path.join(rootDir, 'user-data');
    const libraryDir = getUrlDownloadLibraryDir(userDataDir);
    const sourcePath = path.join(scratchDir, 'download_123_video.mp4');
    await fs.mkdir(scratchDir, { recursive: true });
    await fs.writeFile(sourcePath, 'complete video bytes');

    const promotedPath = await promoteUrlDownload({
      sourcePath,
      libraryDir,
      operationId: 'download-123',
      persistDestinationOwnership: async () => void 0,
    });

    assert.equal(path.dirname(promotedPath), libraryDir);
    await assert.rejects(fs.access(sourcePath), { code: 'ENOENT' });

    await fs.rm(scratchDir, { recursive: true, force: true });
    assert.equal(
      await fs.readFile(promotedPath, 'utf8'),
      'complete video bytes'
    );
  });
});

test('development and production never share URL scratch storage', () => {
  const tempRoot = path.join('/system', 'temp');
  const productionDir = getUrlDownloadScratchDir(tempRoot, true);
  const developmentDir = getUrlDownloadScratchDir(tempRoot, false);

  assert.notEqual(productionDir, developmentDir);
  assert.notEqual(path.basename(productionDir), 'translator-electron');
  assert.notEqual(path.basename(developmentDir), 'translator-electron');
});

test('startup migration cleans only the legacy URL scratch directory', async () => {
  await withTempDir(async rootDir => {
    const legacyDir = path.join(rootDir, 'translator-electron');
    const productionDir = getUrlDownloadScratchDir(rootDir, true);
    const developmentDir = getUrlDownloadScratchDir(rootDir, false);
    await Promise.all([
      fs.mkdir(legacyDir, { recursive: true }),
      fs.mkdir(productionDir, { recursive: true }),
      fs.mkdir(developmentDir, { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(path.join(legacyDir, 'orphaned-video.mp4'), 'legacy bytes'),
      fs.writeFile(path.join(productionDir, 'production-video.mp4'), 'prod'),
      fs.writeFile(path.join(developmentDir, 'development-video.mp4'), 'dev'),
    ]);

    await cleanupLegacyUrlDownloadScratchDir({ systemTempDir: rootDir });

    await assert.rejects(fs.access(legacyDir), { code: 'ENOENT' });
    assert.equal(
      await fs.readFile(
        path.join(productionDir, 'production-video.mp4'),
        'utf8'
      ),
      'prod'
    );
    assert.equal(
      await fs.readFile(
        path.join(developmentDir, 'development-video.mp4'),
        'utf8'
      ),
      'dev'
    );
  });
});

test('startup cleanup reclaims only the interrupted-promotion directory', async () => {
  await withTempDir(async rootDir => {
    const libraryDir = getUrlDownloadLibraryDir(rootDir);
    const partialDir = getUrlDownloadPromotionPartialDir(libraryDir);
    const retainedPath = path.join(libraryDir, 'finished-video.mp4');
    await fs.mkdir(partialDir, { recursive: true });
    await fs.writeFile(
      path.join(partialDir, 'download-123.partial'),
      'incomplete video bytes'
    );
    await fs.writeFile(retainedPath, 'finished video bytes');

    await cleanupInterruptedUrlDownloadPromotions({ libraryDir });

    await assert.rejects(fs.access(partialDir), { code: 'ENOENT' });
    assert.equal(
      await fs.readFile(retainedPath, 'utf8'),
      'finished video bytes'
    );
  });
});

test('promotion never overwrites an existing managed download', async () => {
  await withTempDir(async rootDir => {
    const scratchDir = path.join(rootDir, 'scratch');
    const libraryDir = path.join(rootDir, 'downloaded-media');
    const sourcePath = path.join(scratchDir, 'download_123_video.mp4');
    const existingPath = path.join(libraryDir, 'download_123_video.mp4');
    await fs.mkdir(scratchDir, { recursive: true });
    await fs.mkdir(libraryDir, { recursive: true });
    await fs.writeFile(sourcePath, 'new video');
    await fs.writeFile(existingPath, 'existing video');

    const promotedPath = await promoteUrlDownload({
      sourcePath,
      libraryDir,
      operationId: 'download-456',
      persistDestinationOwnership: async () => void 0,
    });

    assert.notEqual(promotedPath, existingPath);
    assert.equal(await fs.readFile(existingPath, 'utf8'), 'existing video');
    assert.equal(await fs.readFile(promotedPath, 'utf8'), 'new video');
  });
});

test('promotion persists ownership before publishing the final path', async () => {
  await withTempDir(async rootDir => {
    const scratchDir = path.join(rootDir, 'scratch');
    const libraryDir = path.join(rootDir, 'downloaded-media');
    const sourcePath = path.join(scratchDir, 'claimed-video.mp4');
    let claimedPath: string | null = null;
    await fs.mkdir(scratchDir, { recursive: true });
    await fs.writeFile(sourcePath, 'claimed video bytes');

    const promotedPath = await promoteUrlDownload({
      sourcePath,
      libraryDir,
      operationId: 'download-claimed',
      persistDestinationOwnership: async destinationPath => {
        claimedPath = destinationPath;
        await assert.rejects(fs.access(destinationPath), { code: 'ENOENT' });
      },
    });

    assert.equal(claimedPath, promotedPath);
    assert.equal(
      await fs.readFile(promotedPath, 'utf8'),
      'claimed video bytes'
    );
  });
});

test('promotion does not publish when ownership persistence fails', async () => {
  await withTempDir(async rootDir => {
    const scratchDir = path.join(rootDir, 'scratch');
    const libraryDir = path.join(rootDir, 'downloaded-media');
    const sourcePath = path.join(scratchDir, 'unclaimed-video.mp4');
    await fs.mkdir(scratchDir, { recursive: true });
    await fs.writeFile(sourcePath, 'unclaimed video bytes');

    await assert.rejects(
      promoteUrlDownload({
        sourcePath,
        libraryDir,
        operationId: 'download-unclaimed',
        persistDestinationOwnership: async () => {
          throw new Error('ownership persistence failed');
        },
      }),
      /ownership persistence failed/
    );

    assert.equal(
      await fs.readFile(sourcePath, 'utf8'),
      'unclaimed video bytes'
    );
    const libraryEntries = await fs.readdir(libraryDir);
    assert.deepEqual(libraryEntries, [URL_DOWNLOAD_PROMOTION_PARTIAL_DIRNAME]);
  });
});

test('promotion rejects empty completed downloads', async () => {
  await withTempDir(async rootDir => {
    const sourcePath = path.join(rootDir, 'empty.mp4');
    await fs.writeFile(sourcePath, '');

    await assert.rejects(
      promoteUrlDownload({
        sourcePath,
        libraryDir: path.join(rootDir, 'downloaded-media'),
        operationId: 'download-empty',
        persistDestinationOwnership: async () => void 0,
      }),
      /missing or empty/
    );
  });
});

test('history reclamation deletes only requested managed library files', async () => {
  await withTempDir(async rootDir => {
    const libraryDir = path.join(rootDir, 'downloaded-media');
    const reclaimedPath = path.join(libraryDir, 'old-download.mp4');
    const retainedPath = path.join(libraryDir, 'retained-download.mp4');
    await fs.mkdir(libraryDir, { recursive: true });
    await fs.writeFile(reclaimedPath, 'old video');
    await fs.writeFile(retainedPath, 'retained video');

    const result = await reclaimUrlDownloadLibraryFiles({
      libraryDir,
      filePaths: [reclaimedPath],
    });

    assert.deepEqual(result.reclaimedPaths, [reclaimedPath]);
    assert.deepEqual(result.failedPaths, []);
    await assert.rejects(fs.access(reclaimedPath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(retainedPath, 'utf8'), 'retained video');
  });
});

test('history reclamation refuses files outside the managed library', async () => {
  await withTempDir(async rootDir => {
    const libraryDir = path.join(rootDir, 'downloaded-media');
    const outsidePath = path.join(rootDir, 'user-video.mp4');
    await fs.mkdir(libraryDir, { recursive: true });
    await fs.writeFile(outsidePath, 'user video');

    const result = await reclaimUrlDownloadLibraryFiles({
      libraryDir,
      filePaths: [outsidePath],
    });

    assert.deepEqual(result.reclaimedPaths, []);
    assert.deepEqual(result.failedPaths, []);
    assert.equal(await fs.readFile(outsidePath, 'utf8'), 'user video');
  });
});

test('acceptance claims the exact pending file path for promotion', () => {
  const entries = new Map([
    [
      'download-123',
      {
        kind: 'url-result',
        filePath: '/scratch/download_123_video.mp4',
      },
    ],
  ]);

  const claimedPath = claimPendingUrlResultFilePath(
    entries,
    'download-123',
    id => entries.delete(id)
  );

  assert.equal(claimedPath, '/scratch/download_123_video.mp4');
  assert.equal(entries.has('download-123'), false);
});

test('acceptance does not claim an unrelated active operation', () => {
  const entries = new Map([
    [
      'download-123',
      {
        kind: 'download',
        filePath: '/scratch/download_123_video.mp4',
      },
    ],
  ]);

  const claimedPath = claimPendingUrlResultFilePath(
    entries,
    'download-123',
    id => entries.delete(id)
  );

  assert.equal(claimedPath, null);
  assert.equal(entries.has('download-123'), true);
});

test('a null sender frame is treated as a dead IPC handoff', () => {
  assert.equal(
    isIpcInvokeSenderGone({
      sender: { isDestroyed: () => false },
      senderFrame: null,
    } as any),
    true
  );
});

test('an attached sender frame remains eligible for IPC handoff', () => {
  assert.equal(
    isIpcInvokeSenderGone({
      sender: { isDestroyed: () => false },
      senderFrame: { detached: false },
    } as any),
    false
  );
});

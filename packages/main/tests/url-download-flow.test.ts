import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { CancelledError } from '../../shared/cancelled-error.ts';
import { processVideoUrl } from '../services/url-processor/index.ts';
import { consumeCancelMarker, markCancelled } from '../utils/cancel-markers.ts';

test('processVideoUrl uses the FileManager temp dir and returns temp-backed paths', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'translator-url-flow-'));
  try {
    const tempDir = join(rootDir, 'temp-downloads');
    await mkdir(tempDir, { recursive: true });
    const downloadedPath = join(tempDir, 'downloaded-video.mp4');
    await writeFile(downloadedPath, 'video-bytes', 'utf8');

    const progressStages: string[] = [];
    let receivedOutputDir = '';

    const result = await processVideoUrl(
      'https://example.com/watch?v=123',
      'mid',
      progress => {
        progressStages.push(progress.stage);
      },
      'process-video-success',
      {
        fileManager: { getTempDir: () => tempDir } as any,
        ffmpeg: {} as any,
      },
      {
        downloadVideoFromPlatformImpl: async (
          _url,
          outputDir,
          _quality,
          _progressCallback,
          _operationId,
          _services,
          _extraArgs
        ) => {
          receivedOutputDir = outputDir;
          return {
            filepath: downloadedPath,
            info: {},
            proc: { killed: false },
          } as any;
        },
      }
    );

    assert.equal(receivedOutputDir, tempDir);
    assert.equal(result.videoPath, downloadedPath);
    assert.equal(result.originalVideoPath, downloadedPath);
    assert.equal(result.filename, 'downloaded-video.mp4');
    assert.equal(result.fileUrl, `file://${downloadedPath}`);
    assert.ok(progressStages.includes('Download complete'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('processVideoUrl escalates login-required failures to NeedCookies', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'translator-url-needcookies-'));
  try {
    const progressStages: string[] = [];

    await assert.rejects(
      () =>
        processVideoUrl(
          'https://www.youtube.com/watch?v=abc123',
          'mid',
          progress => {
            progressStages.push(progress.stage);
          },
          'process-video-needcookies',
          {
            fileManager: { getTempDir: () => tempDir } as any,
            ffmpeg: {} as any,
          },
          {
            downloadVideoFromPlatformImpl: async () => {
              const error = new Error('Authentication required');
              (error as any).stderr = 'Sign in to confirm you are not a bot';
              throw error;
            },
          }
        ),
      /NeedCookies/
    );

    assert.ok(progressStages.includes('NeedCookies'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('processVideoUrl honors marker-based cancellation during rate-limit backoff', async () => {
  const operationId = 'process-video-cancel-during-backoff';
  const tempDir = await mkdtemp(join(tmpdir(), 'translator-url-cancel-'));

  try {
    const progressStages: string[] = [];

    await assert.rejects(
      () =>
        processVideoUrl(
          'https://www.youtube.com/watch?v=cancelme',
          'mid',
          progress => {
            progressStages.push(progress.stage);
          },
          operationId,
          {
            fileManager: { getTempDir: () => tempDir } as any,
            ffmpeg: {} as any,
          },
          {
            downloadVideoFromPlatformImpl: async () => {
              const error = new Error('429 Too Many Requests');
              (error as any).stderr = 'rate limit exceeded';
              throw error;
            },
            waitImpl: async () => {
              markCancelled(operationId);
            },
          }
        ),
      error => {
        assert.ok(error instanceof CancelledError);
        return true;
      }
    );

    assert.ok(progressStages.includes('Rate limited, retrying...'));
    assert.equal(consumeCancelMarker(operationId), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

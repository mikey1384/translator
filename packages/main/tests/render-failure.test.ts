import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CancelledError } from '../../shared/cancelled-error';
import { ERROR_CODES } from '../../shared/constants';
import { normalizeRenderFailure } from '../utils/render-failure';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

test('render failures use explicit cancellation state instead of message keywords', () => {
  assert.deepEqual(normalizeRenderFailure(new CancelledError()), {
    error: 'Cancelled',
    cancelled: true,
  });
  assert.deepEqual(
    normalizeRenderFailure(
      Object.assign(new Error('stopped'), { cancelled: true })
    ),
    { error: 'Cancelled', cancelled: true }
  );
  assert.deepEqual(
    normalizeRenderFailure(new DOMException('stopped', 'AbortError')),
    { error: 'Cancelled', cancelled: true }
  );
  assert.deepEqual(
    normalizeRenderFailure(
      new Error('Unable to cancel export after disk failure')
    ),
    { error: 'Unable to cancel export after disk failure' }
  );
});

test('an aborted signal is authoritative and disk-full normalization is preserved', () => {
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(
    normalizeRenderFailure(new Error('other'), controller.signal),
    {
      error: 'Cancelled',
      cancelled: true,
    }
  );
  assert.deepEqual(
    normalizeRenderFailure(
      Object.assign(new Error('write failed'), { code: 'ENOSPC' })
    ),
    { error: ERROR_CODES.INSUFFICIENT_DISK_SPACE }
  );
});

test('every render terminal path retires the shared process registry entry', () => {
  const source = fs.readFileSync(
    path.join(
      projectRoot,
      'packages/main/handlers/render-window-handlers/index.ts'
    ),
    'utf8'
  );
  const requestStart = source.indexOf("'render-subtitles-request'");
  const terminalCleanup = source.slice(
    source.lastIndexOf(
      '} finally {',
      source.indexOf("ipcMain.on('render-subtitles-cancel'")
    ),
    source.indexOf("ipcMain.on('render-subtitles-cancel'")
  );

  assert.ok(requestStart >= 0);
  assert.match(terminalCleanup, /registryFinish\(operationId\)/);
});

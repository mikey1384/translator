import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canDeleteDownloadHistoryFile,
  historyRemovalDeletesManagedFile,
  shouldSyncDownloadHistoryMutationResult,
} from './download-history-actions.js';

test('app-library files expose disk deletion without removing history', () => {
  assert.equal(
    canDeleteDownloadHistoryFile({
      managedLocalFile: true,
      canPlay: true,
    }),
    true
  );
  assert.equal(historyRemovalDeletesManagedFile(true), true);
});

test('saved and unavailable files never advertise app-owned disk deletion', () => {
  assert.equal(
    canDeleteDownloadHistoryFile({ managedLocalFile: false, canPlay: true }),
    false
  );
  assert.equal(
    canDeleteDownloadHistoryFile({ managedLocalFile: true, canPlay: false }),
    false
  );
  assert.equal(historyRemovalDeletesManagedFile(false), false);
});

test('only authoritative success or structured deletion outcomes replace cached history', () => {
  assert.equal(
    shouldSyncDownloadHistoryMutationResult({ success: true, items: [] }),
    true
  );
  assert.equal(
    shouldSyncDownloadHistoryMutationResult({
      success: false,
      items: [],
      deletion: {
        operation: 'delete-file',
        diskOutcome: 'deleted',
        historyOutcome: 'pending',
      },
    }),
    true
  );
  assert.equal(
    shouldSyncDownloadHistoryMutationResult({
      success: false,
      items: [],
      error: 'Persistent download history is not available',
    }),
    false
  );
});

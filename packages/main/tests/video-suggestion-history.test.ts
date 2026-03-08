import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeVideoSuggestionHistoryItems } from '../../renderer/containers/GenerateSubtitles/components/VideoSuggestionPanel/video-suggestion-local-storage.js';
import type { VideoSuggestionDownloadHistoryItem } from '../../renderer/containers/GenerateSubtitles/components/VideoSuggestionPanel/VideoSuggestionPanel.types.js';

function makeItem(
  overrides: Partial<VideoSuggestionDownloadHistoryItem>
): VideoSuggestionDownloadHistoryItem {
  return {
    id: overrides.id || `hist-${Math.random().toString(36).slice(2, 8)}`,
    sourceUrl: overrides.sourceUrl || 'https://youtube.com/watch?v=abc123',
    title: overrides.title || 'Example video',
    downloadedAtIso:
      overrides.downloadedAtIso || new Date('2026-03-08T00:00:00.000Z').toISOString(),
    thumbnailUrl: overrides.thumbnailUrl,
    channel: overrides.channel,
    channelUrl: overrides.channelUrl,
    durationSec: overrides.durationSec,
    uploadedAt: overrides.uploadedAt,
    localPath: overrides.localPath,
  };
}

test('mergeVideoSuggestionHistoryItems preserves a saved copy when the same source is re-downloaded to temp', () => {
  const savedCopy = makeItem({
    id: 'saved-copy',
    localPath: '/Users/mikey/Movies/My Saved Video.mp4',
  });
  const redownloadedTempCopy = makeItem({
    id: 'temp-copy',
    localPath: '/var/folders/zz/abc/T/translator-electron/Example Video.mp4',
  });

  const nextItems = mergeVideoSuggestionHistoryItems(
    [savedCopy],
    redownloadedTempCopy
  );

  assert.equal(nextItems.length, 2);
  assert.equal(nextItems[0].localPath, redownloadedTempCopy.localPath);
  assert.equal(nextItems[1].localPath, savedCopy.localPath);
});

test('mergeVideoSuggestionHistoryItems replaces an older temp copy for the same source', () => {
  const oldTempCopy = makeItem({
    id: 'old-temp',
    localPath: '/var/folders/zz/abc/T/translator-electron/Old Example Video.mp4',
  });
  const newTempCopy = makeItem({
    id: 'new-temp',
    localPath: '/var/folders/zz/abc/T/translator-electron/New Example Video.mp4',
  });

  const nextItems = mergeVideoSuggestionHistoryItems(
    [oldTempCopy],
    newTempCopy
  );

  assert.equal(nextItems.length, 1);
  assert.equal(nextItems[0].localPath, newTempCopy.localPath);
});

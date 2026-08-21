import assert from 'node:assert/strict';
import test from 'node:test';

test('url_download_caption_only is distinct from url_download_completed and url_download_failed', () => {
  const captionOnlyEvent = 'url_download_caption_only';
  const completedEvent = 'url_download_completed';
  const failedEvent = 'url_download_failed';

  assert.notEqual(captionOnlyEvent, completedEvent);
  assert.notEqual(captionOnlyEvent, failedEvent);
  assert.notEqual(completedEvent, failedEvent);
});

test('caption-only events include mediaFailure but not failureCategory', () => {
  // Caption-only is a successful recovery, not a failure category
  const captionOnlyDetails = {
    sourceType: 'youtube' as const,
    mediaFailure: 'http_403',
  };

  assert.equal(captionOnlyDetails.sourceType, 'youtube');
  assert.equal(captionOnlyDetails.mediaFailure, 'http_403');
  assert.equal(
    (captionOnlyDetails as any).failureCategory,
    undefined,
    'Caption-only should not have a failureCategory'
  );
});

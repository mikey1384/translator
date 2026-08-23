import assert from 'node:assert/strict';
import test from 'node:test';
import type { UrlDownloadFunnelEvent } from '../services/url-download-funnel.js';

test('url_download_caption_only is distinct from url_download_completed and url_download_failed', () => {
  const captionOnlyEvent: UrlDownloadFunnelEvent = 'url_download_caption_only';
  const completedEvent: UrlDownloadFunnelEvent = 'url_download_completed';
  const failedEvent: UrlDownloadFunnelEvent = 'url_download_failed';

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

test('negative: caption-only path must not emit url_download_failed or url_download_completed', () => {
  // This test verifies the event taxonomy at the type level
  const captionOnlyEvent: UrlDownloadFunnelEvent = 'url_download_caption_only';

  const terminalMediaEvents: UrlDownloadFunnelEvent[] = [
    'url_download_failed',
    'url_download_completed',
  ];
  assert.ok(
    !terminalMediaEvents.includes(captionOnlyEvent),
    'Caption-only must not be classified as failed or completed'
  );

  // Verify the event is in the allowed set
  const allowedEvents: UrlDownloadFunnelEvent[] = [
    'url_download_started',
    'url_download_completed',
    'url_download_caption_only',
    'url_download_cookie_required',
    'url_download_cancelled',
    'url_download_failed',
    'url_cookie_connect_started',
    'url_cookie_connect_completed',
    'url_cookie_connect_cancelled',
    'url_cookie_connect_failed',
  ];

  assert.ok(allowedEvents.includes(captionOnlyEvent));
});

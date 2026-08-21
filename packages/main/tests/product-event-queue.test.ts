import assert from 'node:assert/strict';
import test from 'node:test';
import {
  queueProductEvent,
  listPendingProductEvents,
  acknowledgeProductEvent,
  clearAllPendingEvents,
} from '../services/product-event-queue.js';

test('product event queue persists failed events', () => {
  clearAllPendingEvents();

  const event1 = {
    eventId: 'test-1',
    event: 'transcription_started' as const,
  };
  const event2 = {
    eventId: 'test-2',
    event: 'dubbing_completed' as const,
  };

  queueProductEvent(event1);
  queueProductEvent(event2);

  const pending = listPendingProductEvents();
  assert.equal(pending.length, 2);
  assert.equal(pending[0].eventId, 'test-1');
  assert.equal(pending[1].eventId, 'test-2');

  clearAllPendingEvents();
});

test('acknowledging an event removes it from the queue', () => {
  clearAllPendingEvents();

  queueProductEvent({
    eventId: 'ack-test-1',
    event: 'summary_started' as const,
  });
  queueProductEvent({
    eventId: 'ack-test-2',
    event: 'merge_completed' as const,
  });

  let pending = listPendingProductEvents();
  assert.equal(pending.length, 2);

  acknowledgeProductEvent('ack-test-1');

  pending = listPendingProductEvents();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].eventId, 'ack-test-2');

  clearAllPendingEvents();
});

test('queue survives failed POST and flushes later', () => {
  clearAllPendingEvents();

  // Simulate a failed POST by queueing events
  queueProductEvent({
    eventId: 'retry-1',
    event: 'transcription_failed' as const,
  });
  queueProductEvent({
    eventId: 'retry-2',
    event: 'url_download_caption_only' as const,
    urlDownload: {
      sourceType: 'youtube',
      mediaFailure: 'http_403',
    },
  });

  const pending = listPendingProductEvents();
  assert.equal(pending.length, 2);
  assert.equal(pending[0].event, 'transcription_failed');
  assert.equal(pending[1].event, 'url_download_caption_only');
  assert.equal(pending[1].urlDownload?.mediaFailure, 'http_403');

  clearAllPendingEvents();
});

test('queued events contain no URLs or paths', () => {
  clearAllPendingEvents();

  queueProductEvent({
    eventId: 'privacy-test',
    event: 'dubbing_credit_blocked' as const,
  });

  const pending = listPendingProductEvents();
  const serialized = JSON.stringify(pending);

  // No file paths, URLs, or user content
  assert.ok(!serialized.includes('/'));
  assert.ok(!serialized.includes('\\'));
  assert.ok(!serialized.includes('http'));
  assert.ok(!serialized.includes('.mp4'));
  assert.ok(!serialized.includes('.srt'));

  clearAllPendingEvents();
});

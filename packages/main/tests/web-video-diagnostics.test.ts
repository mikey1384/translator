import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWebVideoDiagnostics,
  manifestFailureOutcome,
} from '../services/web-video-diagnostics.js';
import { webVideoManifestRequest } from '../services/web-video-request.js';

test('manifest inspection preserves playback identity with an explicit referrer policy', () => {
  const request = webVideoManifestRequest(
    'https://cdn.example.com/video.m3u8',
    'https://example.com/?video=demo#player',
    'DemoBrowser/1'
  );
  assert.deepEqual(request, {
    headers: {
      Referer: 'https://example.com/?video=demo',
      'User-Agent': 'DemoBrowser/1',
    },
    referrerPolicy: 'no-referrer-when-downgrade',
    credentials: 'include',
    redirect: 'error',
  });
});

test('manifest inspection does not send a secure-page referrer over plain HTTP', () => {
  const request = webVideoManifestRequest(
    'http://cdn.example.com/video.m3u8',
    'https://example.com/private-page',
    'DemoBrowser/1'
  );
  assert.equal((request.headers as Record<string, string>).Referer, undefined);
});

test('local discovery diagnostics retain only bounded counters and known categories', () => {
  const entries: Record<string, string | number>[] = [];
  const record = createWebVideoDiagnostics(entry => entries.push(entry));
  record('manifest_checked', {
    count: Infinity,
    attempt: -1,
    httpStatus: 403,
    kind: 'hls',
    outcome: 'http_error',
    url: 'https://example.com/private?token=secret',
    title: 'Private title',
    headers: { Cookie: 'secret' },
    error: 'Private error',
  } as any);
  record('manifest_checked', {
    kind: 'https://example.com/private',
    outcome: 'secret',
  } as any);
  assert.equal(entries[0].httpStatus, 403);
  assert.equal(entries[0].attempt, 0);
  assert.equal(entries[0].count, undefined);
  assert.equal(entries[0].trace, entries[1].trace);
  assert.equal(entries[1].kind, undefined);
  assert.equal(entries[1].outcome, undefined);
  assert.doesNotMatch(JSON.stringify(entries), /secret|Private|example\.com/);
  for (let i = 0; i < 200; i++) record('blob_observed');
  assert.equal(entries.length, 160);
});

test('diagnostics classify failures without exposing server messages', () => {
  assert.equal(
    manifestFailureOutcome(new Error('net::ERR_BLOCKED_BY_CLIENT')),
    'request_blocked'
  );
  assert.equal(
    manifestFailureOutcome(new DOMException('private', 'TimeoutError')),
    'timeout'
  );
  assert.equal(
    manifestFailureOutcome(new DOMException('private', 'AbortError')),
    'cancelled'
  );
  assert.equal(
    manifestFailureOutcome(
      new Error('https://example.com/private?token=secret')
    ),
    'network_error'
  );
});

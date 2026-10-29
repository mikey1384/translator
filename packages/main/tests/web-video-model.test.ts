import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeWebVideoUrl,
  sourcesFromYtDlp,
  WebVideoDiscoveries,
  inspectWebVideoManifest,
  isProtectedWebVideoError,
} from '../services/web-video-model.js';

const page = 'https://example.com/watch';
test('DRM classification uses the extractor error, never words echoed in a URL', () => {
  assert.equal(
    isProtectedWebVideoError(
      'ERROR: Unsupported URL: https://example.com/drm-protected/demo'
    ),
    false
  );
  assert.equal(
    isProtectedWebVideoError('ERROR: This video is DRM protected'),
    true
  );
  assert.equal(
    isProtectedWebVideoError(
      '[generic] https://example.com/video: This content is protected by DRM'
    ),
    true
  );
});
test('stream discovery distinguishes complete videos, live streams and protected manifests', () => {
  assert.deepEqual(
    inspectWebVideoManifest('#EXTM3U\n#EXTINF:3,\na.ts\n#EXT-X-ENDLIST'),
    { kind: 'vod' }
  );
  assert.deepEqual(inspectWebVideoManifest('#EXTM3U\n#EXTINF:3,\na.ts'), {
    kind: 'live',
  });
  assert.deepEqual(
    inspectWebVideoManifest(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n low.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000\nhigh.m3u8'
    ),
    { kind: 'master', variants: ['low.m3u8', 'high.m3u8'] }
  );
  assert.deepEqual(inspectWebVideoManifest('<MPD type="static"></MPD>'), {
    kind: 'vod',
  });
  assert.deepEqual(inspectWebVideoManifest("<MPD type='dynamic'></MPD>"), {
    kind: 'live',
  });
  for (const body of [
    '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES',
    '<MPD><ContentProtection/></MPD>',
    '<MPD><mpd:ContentProtection/></MPD>',
  ])
    assert.deepEqual(inspectWebVideoManifest(body), { kind: 'protected' });
  assert.deepEqual(inspectWebVideoManifest('<html>Please sign in</html>'), {
    kind: 'invalid',
  });
});
test('web media accepts public HTTP(S), never credentials, local files or private addresses', () => {
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'blob:https://example.com/abc',
    'https://user:secret@example.com/a',
    'http://127.0.0.1/a',
    'http://2130706433/a',
    'http://0x7f000001/a',
    'http://10.1.2.3/a',
    'http://172.16.0.1/a',
    'http://192.168.0.1/a',
    'http://[::1]/a',
    'http://[::ffff:127.0.0.1]/a',
    'http://router.local/a',
  ])
    assert.equal(safeWebVideoUrl(url), null, url);
  assert.equal(
    safeWebVideoUrl('/video.mp4', page),
    'https://example.com/video.mp4'
  );
  assert.equal(
    safeWebVideoUrl('https://cdn.example.com/video.m3u8?token=opaque'),
    'https://cdn.example.com/video.m3u8?token=opaque'
  );
});
test('a page keeps distinct videos and quality formats while dropping unsafe extractor instructions', () => {
  const input = {
    entries: [
      {
        id: '../../bad',
        title: 'First',
        _filename: '/sensitive',
        formats: [
          {
            format_id: 'low',
            url: 'https://cdn.example.com/low.mp4',
            height: 360,
            ext: 'mp4',
            http_headers: { Authorization: 'secret', 'User-Agent': 'fixture' },
          },
          {
            format_id: 'high',
            url: 'https://cdn.example.com/high.mp4',
            height: 1080,
            ext: 'mp4',
          },
          { url: 'file:///sensitive' },
          { url: 'https://cdn.example.com/drm.mpd', has_drm: true },
        ],
      },
      {
        id: 'second',
        title: 'Second',
        url: 'https://cdn.example.com/second.mp4',
      },
    ],
  };
  const sources = sourcesFromYtDlp(input, page);
  assert.equal(sources.length, 2);
  assert.notEqual(sources[0].candidate.id, sources[1].candidate.id);
  const formats = sources[0].info!.formats as any[];
  assert.deepEqual(
    formats.map(f => f.height),
    [360, 1080]
  );
  assert.equal(formats[0].http_headers.Authorization, undefined);
  assert.equal(sources[0].info!._filename, undefined);
  assert.equal(sources[0].info!.extractor, 'generic');
  assert.equal(sources[0].info!.webpage_url, undefined);
  assert.match(String(sources[0].info!.id), /^[a-f0-9]{32}$/);
  assert.equal(
    JSON.stringify(sources.map(s => s.candidate)).includes('cdn.example.com'),
    false
  );
});
test('DASH fragments remain attached to their selected format and DRM or live video is excluded', () => {
  const [source] = sourcesFromYtDlp(
    {
      id: 'dash',
      formats: [
        {
          url: 'https://cdn.example.com/a/manifest.mpd',
          protocol: 'http_dash_segments',
          fragment_base_url: 'https://cdn.example.com/a/',
          fragments: [{ path: 'init.mp4' }, { path: '1.m4s', duration: 2 }],
        },
      ],
    },
    page
  );
  assert.deepEqual((source.info!.formats as any[])[0].fragments, [
    { url: 'https://cdn.example.com/a/init.mp4' },
    { url: 'https://cdn.example.com/a/1.m4s', duration: 2 },
  ]);
  for (const flag of [
    { has_drm: true },
    { is_live: true },
    { live_status: 'is_upcoming' },
  ])
    assert.deepEqual(
      sourcesFromYtDlp(
        { url: 'https://cdn.example.com/stream.m3u8', ...flag },
        page
      ),
      []
    );
});
test('discovered sources are bound to the tab and page, expire, and can be released', () => {
  let now = 0;
  const store = new WebVideoDiscoveries(() => now);
  const sources = sourcesFromYtDlp(
    { id: 'one', url: 'https://cdn.example.com/a.mp4' },
    page
  );
  const discoveryId = store.put(10, page, sources);
  const selection = { discoveryId, candidateId: sources[0].candidate.id };
  assert.equal(store.get(10, page, selection), sources[0]);
  assert.throws(() => store.get(11, page, selection));
  assert.throws(() => store.get(10, 'https://example.com/other', selection));
  store.remove(11, discoveryId);
  assert.equal(store.get(10, page, selection), sources[0]);
  now = 20 * 60_000;
  assert.throws(() => store.get(10, page, selection));
  const next = store.put(10, page, sources);
  store.remove(10);
  assert.throws(() => store.get(10, page, { ...selection, discoveryId: next }));
});

test('browser lifetime survives selection lookup and ends on owner release, expiry or eviction', () => {
  let now = 0;
  const store = new WebVideoDiscoveries(() => now);
  const closed: string[] = [];
  const make = () => [
    {
      ...sourcesFromYtDlp(
        { id: 'one', url: 'https://cdn.example.com/a.mp4' },
        page
      )[0],
      browser: {
        cancelled: false,
        close: (reason: string) => {
          closed.push(reason);
        },
      },
    },
  ];
  const sources = make();
  const discoveryId = store.put(10, page, sources);
  store.get(10, page, { discoveryId, candidateId: sources[0].candidate.id });
  store.remove(11, discoveryId);
  assert.deepEqual(closed, []);
  store.remove(10, discoveryId);
  assert.deepEqual(closed, ['released']);
  store.put(10, page, make());
  now = 20 * 60_000;
  for (let i = 0; i < 17; i++) store.put(10, page, make());
  assert.equal(closed.length, 3); // release + expiry + oldest-capability eviction
  store.remove(10);
  assert.equal(closed.length, 19);
});

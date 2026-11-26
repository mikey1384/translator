import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOpenVideoDeepLink } from '../utils/open-video-deep-link.js';

test('accepts valid public http(s) URLs from stage5-translator://open?url=...', () => {
  assert.equal(
    parseOpenVideoDeepLink(
      'stage5-translator://open?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1xx411c7mD%3Fp%3D2'
    ),
    'https://www.bilibili.com/video/BV1xx411c7mD?p=2'
  );
  assert.equal(
    parseOpenVideoDeepLink(
      'STAGE5-TRANSLATOR://open?url=http%3A%2F%2Fvimeo.com%2F123456'
    ),
    'http://vimeo.com/123456'
  );
});

test('rejects dangerous schemes, credentials, private/loopback hosts, and oversized URLs', () => {
  const rejected = [
    'stage5-translator://open?url=file%3A%2F%2F%2Fetc%2Fpasswd',
    'stage5-translator://open?url=javascript%3Aalert(1)',
    'stage5-translator://open?url=data%3Atext%2Fhtml%2C%3Cscript%3E',
    'stage5-translator://open?url=https%3A%2F%2Fuser%3Apass%40example.com%2Fv',
    'stage5-translator://open?url=http%3A%2F%2Flocalhost%3A3000%2Fv',
    'stage5-translator://open?url=http%3A%2F%2F127.0.0.1%3A8080%2Fv',
    'stage5-translator://open?url=http%3A%2F%2F192.168.1.5%2Fv',
    'stage5-translator://open?url=http%3A%2F%2F10.0.0.2%2Fv',
    'stage5-translator://open?url=http%3A%2F%2F172.16.0.1%2Fv',
    'stage5-translator://open?url=http%3A%2F%2F169.254.169.254%2Flatest',
    'stage5-translator://open?url=http%3A%2F%2F%5B%3A%3A1%5D%2Fv',
    'stage5-translator://open?url=http%3A%2F%2Fmybox.local%2Fv',
    'stage5-translator://open?url=not-a-url',
    'stage5-translator://open',
    'stage5-translator://checkout-return?status=success',
    `stage5-translator://open?url=${encodeURIComponent(`https://example.com/${'a'.repeat(4100)}`)}`,
  ];

  for (const input of rejected) {
    assert.equal(parseOpenVideoDeepLink(input), null, input);
  }
});

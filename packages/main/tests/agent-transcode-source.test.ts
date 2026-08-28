import assert from 'node:assert/strict';
import type { BigIntStats } from 'node:fs';
import test from 'node:test';

import {
  parseExpectedAgentFileFingerprint,
  verifyAgentTranscodeSourceSnapshot,
} from '../utils/agent-transcode-source.js';

const EXPECTED_SHA256 = 'a'.repeat(64);

function snapshot(
  overrides: Partial<
    Pick<BigIntStats, 'dev' | 'ino' | 'size' | 'mtimeNs' | 'ctimeNs'>
  > = {}
): BigIntStats {
  return {
    dev: 1n,
    ino: 2n,
    size: 3n,
    mtimeNs: 4n,
    ctimeNs: 5n,
    ...overrides,
  } as BigIntStats;
}

test('expected transcode fingerprints are all-or-nothing and bounded', () => {
  assert.equal(parseExpectedAgentFileFingerprint(null), null);
  assert.deepEqual(
    parseExpectedAgentFileFingerprint({
      sha256: EXPECTED_SHA256.toUpperCase(),
      bytes: 3,
    }),
    { sha256: EXPECTED_SHA256, bytes: 3 }
  );
  assert.throws(
    () => parseExpectedAgentFileFingerprint({ sha256: EXPECTED_SHA256 }),
    /fingerprint is invalid/
  );
  assert.throws(
    () =>
      parseExpectedAgentFileFingerprint({
        sha256: 'not-a-digest',
        bytes: 3,
      }),
    /fingerprint is invalid/
  );
  assert.throws(
    () =>
      parseExpectedAgentFileFingerprint({
        sha256: EXPECTED_SHA256,
        bytes: '3',
      }),
    /fingerprint is invalid/
  );
  assert.throws(
    () =>
      parseExpectedAgentFileFingerprint({
        sha256: EXPECTED_SHA256,
        bytes: null,
      }),
    /fingerprint is invalid/
  );
});

test('unchanged source avoids an extra full-file fingerprint pass', async () => {
  let fingerprintCalls = 0;
  const result = await verifyAgentTranscodeSourceSnapshot({
    sourcePath: '/tmp/master.mp4',
    before: snapshot(),
    after: snapshot(),
    expectedFingerprint: { sha256: EXPECTED_SHA256, bytes: 3 },
    fingerprintFile: async () => {
      fingerprintCalls += 1;
      return { sha256: EXPECTED_SHA256, bytes: 3 };
    },
  });
  assert.deepEqual(result, {
    verified: true,
    metadataOnlyChange: false,
    reason: null,
  });
  assert.equal(fingerprintCalls, 0);
});

test('ctime-only churn on a claimed master is revalidated by SHA-256', async () => {
  let fingerprintCalls = 0;
  const result = await verifyAgentTranscodeSourceSnapshot({
    sourcePath: '/tmp/master.mp4',
    before: snapshot(),
    after: snapshot({ ctimeNs: 6n }),
    expectedFingerprint: { sha256: EXPECTED_SHA256, bytes: 3 },
    fingerprintFile: async () => {
      fingerprintCalls += 1;
      return { sha256: EXPECTED_SHA256, bytes: 3 };
    },
  });
  assert.deepEqual(result, {
    verified: true,
    metadataOnlyChange: true,
    reason: null,
  });
  assert.equal(fingerprintCalls, 1);
});

test('ctime-only churn still fails closed without an exact claimed fingerprint', async () => {
  const result = await verifyAgentTranscodeSourceSnapshot({
    sourcePath: '/tmp/master.mp4',
    before: snapshot(),
    after: snapshot({ ctimeNs: 6n }),
    expectedFingerprint: null,
  });
  assert.deepEqual(result, {
    verified: false,
    metadataOnlyChange: true,
    reason: 'metadata_changed_without_fingerprint',
  });
});

test('ctime-only churn rejects content that no longer matches its claim', async () => {
  const result = await verifyAgentTranscodeSourceSnapshot({
    sourcePath: '/tmp/master.mp4',
    before: snapshot(),
    after: snapshot({ ctimeNs: 6n }),
    expectedFingerprint: { sha256: EXPECTED_SHA256, bytes: 3 },
    fingerprintFile: async () => ({ sha256: 'b'.repeat(64), bytes: 3 }),
  });
  assert.deepEqual(result, {
    verified: false,
    metadataOnlyChange: true,
    reason: 'fingerprint_mismatch',
  });
});

test('identity, size, and mtime changes reject without a fallback hash', async () => {
  for (const after of [
    snapshot({ dev: 9n }),
    snapshot({ ino: 9n }),
    snapshot({ size: 9n }),
    snapshot({ mtimeNs: 9n }),
  ]) {
    let fingerprintCalls = 0;
    const result = await verifyAgentTranscodeSourceSnapshot({
      sourcePath: '/tmp/master.mp4',
      before: snapshot(),
      after,
      expectedFingerprint: { sha256: EXPECTED_SHA256, bytes: 3 },
      fingerprintFile: async () => {
        fingerprintCalls += 1;
        return { sha256: EXPECTED_SHA256, bytes: 3 };
      },
    });
    assert.deepEqual(result, {
      verified: false,
      metadataOnlyChange: false,
      reason: 'identity_or_content_metadata_changed',
    });
    assert.equal(fingerprintCalls, 0);
  }
});

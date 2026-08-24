import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundedMetadataText,
  boundedSourceIdentity,
  finitePositiveMetadataNumber,
  safeHttpMetadataUrl,
} from '../utils/agent-source-metadata.js';

test('untrusted source metadata is bounded without truncating exact identities', () => {
  assert.equal(
    boundedMetadataText('Title\nwith\tspacing', 100),
    'Title with spacing'
  );
  assert.equal(boundedMetadataText('😀'.repeat(20), 3), '😀😀😀');
  assert.equal(boundedSourceIdentity('video-123', 20), 'video-123');
  assert.equal(boundedSourceIdentity(12345, 20), '12345');
  assert.equal(boundedSourceIdentity({ id: 'video-123' }, 20), null);
  assert.equal(boundedSourceIdentity(Number.POSITIVE_INFINITY, 20), null);
  assert.equal(boundedSourceIdentity('x'.repeat(21), 20), null);
  assert.equal(boundedSourceIdentity('unsafe\nidentity', 100), null);
});

test('source metadata URLs and numbers fail closed on unsafe values', () => {
  assert.equal(
    safeHttpMetadataUrl('https://example.com/thumb.jpg#fragment'),
    'https://example.com/thumb.jpg'
  );
  assert.equal(safeHttpMetadataUrl('file:///etc/passwd'), null);
  assert.equal(safeHttpMetadataUrl('https://user:secret@example.com/a'), null);
  assert.equal(safeHttpMetadataUrl('not a URL'), null);
  assert.equal(finitePositiveMetadataNumber('42', { integer: true }), 42);
  assert.equal(finitePositiveMetadataNumber(Number.POSITIVE_INFINITY), null);
  assert.equal(finitePositiveMetadataNumber(-1), null);
  assert.equal(
    finitePositiveMetadataNumber(101, { maximum: 100, integer: true }),
    null
  );
});

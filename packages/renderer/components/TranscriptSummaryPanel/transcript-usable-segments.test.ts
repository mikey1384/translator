import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSummaryInputSignature,
  buildSummaryRunAttachmentSignature,
} from './transcript-usable-segments';

const base = {
  summaryLanguage: 'English',
  effortLevel: 'standard' as const,
  semanticSourceIdentity: 'original:/videos/a.mp4',
};

test('editing a line keeps a running summary attached (never cancels a paid run)', () => {
  const before = buildSummaryInputSignature({
    segments: [{ start: 0, end: 1, text: 'hello' }],
    summaryLanguage: base.summaryLanguage,
    effortLevel: base.effortLevel,
  });
  const after = buildSummaryInputSignature({
    segments: [{ start: 0, end: 1, text: 'hello there' }],
    summaryLanguage: base.summaryLanguage,
    effortLevel: base.effortLevel,
  });
  // The request changed, so the result is marked as made from earlier lines…
  assert.notEqual(before, after);
  // …but the run is still for the same video, language and quality.
  assert.equal(
    buildSummaryRunAttachmentSignature(base),
    buildSummaryRunAttachmentSignature({ ...base })
  );
});

test('another video, language or quality detaches the run', () => {
  const attached = buildSummaryRunAttachmentSignature(base);
  assert.notEqual(
    attached,
    buildSummaryRunAttachmentSignature({
      ...base,
      semanticSourceIdentity: 'original:/videos/b.mp4',
    })
  );
  assert.notEqual(
    attached,
    buildSummaryRunAttachmentSignature({ ...base, summaryLanguage: 'Korean' })
  );
  assert.notEqual(
    attached,
    buildSummaryRunAttachmentSignature({ ...base, effortLevel: 'high' })
  );
  assert.equal(
    attached,
    buildSummaryRunAttachmentSignature({ ...base, summaryLanguage: 'english' })
  );
});

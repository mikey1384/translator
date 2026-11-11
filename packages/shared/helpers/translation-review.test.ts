import test from 'node:test';
import assert from 'node:assert/strict';
import {
  withTranslationReview,
  translationReviewStatus,
  translationReviewNeedsDecision,
  acceptTranslationDraft,
} from './translation-review';
import {
  buildSubtitleSidecarContent,
  restoreSegmentsFromSubtitleSidecar,
} from './subtitle-sidecar';
import { buildSrt } from './index';
import { splitCue, mergeCues } from '../../renderer/utils/subtitle-split-merge';
const cue = {
  id: 'a',
  index: 1,
  start: 0,
  end: 4,
  original: 'Please check the label',
  translation: 'Compruebe la etiqueta',
};
test('review checkpoints survive sidecar save/reopen and bind both texts and language', () => {
  const segment = withTranslationReview(cue, 'Spanish', 'complete');
  const srt = buildSrt({ segments: [segment], mode: 'dual' });
  const restored = restoreSegmentsFromSubtitleSidecar({
    srtContent: srt,
    sidecarContent: buildSubtitleSidecarContent({
      segments: [segment],
      srtContent: srt,
    }),
  })!;
  assert.equal(translationReviewStatus(restored[0], 'Spanish'), 'complete');
  assert.equal(
    translationReviewStatus(
      { ...restored[0], original: 'Changed source' },
      'Spanish'
    ),
    'pending'
  );
  assert.equal(
    translationReviewStatus(
      { ...restored[0], translation: 'Edited draft' },
      'Spanish'
    ),
    'pending'
  );
  assert.equal(translationReviewStatus(restored[0], 'Korean'), undefined);
});
test('splitting and merging text invalidate completion without losing the review request', () => {
  const segment = withTranslationReview(cue, 'Spanish', 'complete');
  const parts = splitCue(segment, { newId: 'b' })!;
  assert(parts.every(s => translationReviewStatus(s, 'Spanish') === 'pending'));
  const merged = mergeCues(
    { ...cue, id: 'c', translationReview: undefined },
    segment
  );
  assert.equal(translationReviewStatus(merged, 'Spanish'), 'pending');
});

test('Keep draft is durable, never claims review complete, and expires after edits', () => {
  const pending = withTranslationReview(cue, 'Spanish', 'pending');
  assert.equal(translationReviewNeedsDecision(pending), true);
  const accepted = acceptTranslationDraft(pending);
  const srt = buildSrt({ segments: [accepted], mode: 'dual' });
  const restored = restoreSegmentsFromSubtitleSidecar({
    srtContent: srt,
    sidecarContent: buildSubtitleSidecarContent({
      segments: [accepted],
      srtContent: srt,
    }),
  })![0];
  assert.equal(translationReviewNeedsDecision(restored), false);
  assert.equal(translationReviewStatus(restored, 'Spanish'), 'pending');
  assert.equal(
    translationReviewNeedsDecision({
      ...restored,
      translation: 'Edited draft',
    }),
    true
  );
  assert.equal(
    translationReviewNeedsDecision({
      ...restored,
      translationReview: {
        ...restored.translationReview!,
        targetLanguage: 'Korean',
      },
    }),
    true
  );
});

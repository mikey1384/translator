import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_PREVIEW_SEC,
  creditsToFinish,
  creditsToStart,
  needsTailTranscription,
  packToFinish,
  planFreePreview,
  previewMinuteSplit,
} from './freePreview';

test('a balance that covers the video runs it whole', () => {
  const plan = planFreePreview({
    durationSecs: 60,
    credits: 150_000,
    qualityEnabled: false,
  });
  assert.deepEqual(plan, { kind: 'full' });
});

test('quality cost estimates never turn an affordable 127-minute transcription into 106 minutes', () => {
  const durationSecs = 7593.5069;
  const credits = 266143;
  assert.ok(creditsToFinish(durationSecs, true) > credits);
  assert.ok(creditsToStart(durationSecs, true) < credits);
  assert.deepEqual(
    planFreePreview({ durationSecs, credits, qualityEnabled: true }),
    { kind: 'full' }
  );
});

test('processed audio survives a silent ending without charging for the tail again', () => {
  assert.equal(
    needsTailTranscription({
      transcribedToEnd: true,
      durationSecs: 7600,
      lastEndSecs: 6500,
      coverage: { endSec: 7600, durationSec: 7600 },
    }),
    false
  );
  assert.equal(
    needsTailTranscription({
      durationSecs: 7600,
      lastEndSecs: 6500,
      coverage: { endSec: 6405, durationSec: 7600 },
    }),
    true
  );
  // Coverage from another media duration must never suppress recovery.
  assert.equal(
    needsTailTranscription({
      durationSecs: 7600,
      lastEndSecs: 6500,
      coverage: { endSec: 7000, durationSec: 7000 },
    }),
    true
  );
});

test('monthly free credits give a few-minute preview of a long video', () => {
  const plan = planFreePreview({
    durationSecs: 28 * 60,
    credits: 2500,
    qualityEnabled: false,
  });
  assert.equal(plan.kind, 'preview');
  if (plan.kind !== 'preview') return;
  assert.ok(plan.previewSecs >= 3 * 60 && plan.previewSecs <= 5 * 60);
  assert.equal(plan.previewSecs % 15, 0);
  // The preview itself must fit the balance, holds included.
  assert.ok(creditsToFinish(plan.previewSecs, false) <= 2500);
});

test('no credits, or too few for a useful preview, means offer only', () => {
  for (const credits of [0, 400, 900]) {
    const plan = planFreePreview({
      durationSecs: 600,
      credits,
      qualityEnabled: false,
    });
    assert.deepEqual(plan, { kind: 'none' }, `credits ${credits}`);
  }
  assert.ok(MIN_PREVIEW_SEC >= 30);
});

test('quality review needs far more headroom, so small balances offer only', () => {
  const plan = planFreePreview({
    durationSecs: 28 * 60,
    credits: 2500,
    qualityEnabled: true,
  });
  assert.deepEqual(plan, { kind: 'none' });
});

test('the $1 pack finishes a 28-minute video, matching "$1 ≈ 32m" in Settings', () => {
  assert.equal(
    packToFinish({ remainingSecs: 28 * 60, credits: 0, qualityEnabled: false })
      .pack.id,
    'MICRO'
  );
});

test('the offer names the smallest pack that finishes the video', () => {
  assert.equal(
    packToFinish({ remainingSecs: 24 * 60, credits: 0, qualityEnabled: false })
      .pack.id,
    'MICRO'
  );
  assert.equal(
    packToFinish({ remainingSecs: 2 * 3600, credits: 0, qualityEnabled: false })
      .pack.id,
    'STARTER'
  );
  const huge = packToFinish({
    remainingSecs: 200 * 3600,
    credits: 0,
    qualityEnabled: false,
  });
  assert.equal(huge.pack.id, 'PRO');
  assert.equal(huge.coversAll, false);
});

test('video cost reads covered, preview-then-pack, or pack', async () => {
  const { describeVideoCost } = await import('./freePreview');
  assert.deepEqual(
    describeVideoCost({
      durationSecs: 600,
      credits: 150_000,
      qualityEnabled: false,
    }),
    { kind: 'covered' }
  );
  const preview = describeVideoCost({
    durationSecs: 28 * 60,
    credits: 2500,
    qualityEnabled: false,
  });
  assert.equal(preview.kind, 'preview');
  if (preview.kind === 'preview') {
    assert.ok(preview.previewMinutes >= 3 && preview.previewMinutes <= 5);
    assert.equal(preview.wholeVideoPrice, 1);
  }
  assert.deepEqual(
    describeVideoCost({
      durationSecs: 2 * 3600,
      credits: 0,
      qualityEnabled: false,
    }),
    { kind: 'offer', wholeVideoPrice: 5 }
  );
});

test('offer minutes add up however the seconds round', () => {
  // The audit's case: a 90 s preview of a 734 s video read "2 of 12 … 11".
  const split = previewMinuteSplit({ coveredSecs: 90, durationSecs: 734 });
  assert.equal(split.covered + split.remaining, split.total);
  assert.deepEqual(split, { covered: 1, total: 12, remaining: 11 });
  for (const [coveredSecs, durationSecs] of [
    [150, 720],
    [45, 61],
    [599, 600],
    [0, 300],
    [300, 300],
  ]) {
    const s = previewMinuteSplit({ coveredSecs, durationSecs });
    assert.equal(s.covered + s.remaining, s.total);
    if (coveredSecs < durationSecs) assert.ok(s.remaining >= 1);
  }
});

test('a retry after the tail was transcribed only translates', () => {
  assert.equal(
    needsTailTranscription({ durationSecs: 734, lastEndSecs: 90 }),
    true
  );
  assert.equal(
    needsTailTranscription({
      transcribedToEnd: true,
      durationSecs: 734,
      lastEndSecs: 730,
    }),
    false
  );
  // The tail lines were lost (restart before saving): transcribe again.
  assert.equal(
    needsTailTranscription({
      transcribedToEnd: true,
      durationSecs: 734,
      lastEndSecs: 90,
    }),
    true
  );
});

test('the offer never promises a top-up date while the welcome grant is pending', async () => {
  const { offerNoneBodyKind } = await import('./freePreview');
  assert.equal(
    offerNoneBodyKind({ balanceState: 'welcomePending', hasMonthlyFree: true }),
    'welcomePending'
  );
  assert.equal(
    offerNoneBodyKind({ balanceState: 'freeBack', hasMonthlyFree: true }),
    'nextFree'
  );
  assert.equal(
    offerNoneBodyKind({ balanceState: 'empty', hasMonthlyFree: false }),
    'plain'
  );
});

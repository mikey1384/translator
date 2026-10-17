import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_PREVIEW_SEC,
  creditsToFinish,
  packToFinish,
  planFreePreview,
} from './freePreview';

test('a balance that covers the video runs it whole', () => {
  const plan = planFreePreview({
    durationSecs: 60,
    credits: 150_000,
    qualityEnabled: false,
  });
  assert.deepEqual(plan, { kind: 'full' });
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

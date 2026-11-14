import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeHandoffCost,
  handoffPrimaryLabel,
  savedFolderName,
  shouldShowDownloadHandoff,
} from './downloadHandoff';
import { carryProbeToSavedCopy } from './savedCopyProbe';
import {
  describeVideoCost,
  creditsToStart,
  MIN_PREVIEW_SEC,
} from './freePreview';
import {
  downloadHandoffKey,
  useDownloadHandoffStore,
  type DownloadHandoff,
} from '../state/download-handoff-store';

const ready: DownloadHandoff = { key: 'u', status: 'ready', updatedAt: 1 };
const base = {
  handoff: ready,
  hasVideo: true,
  subtitleCount: 0,
  busy: false,
  previewStands: false,
  interrupted: false,
  unreadable: false,
  checking: false,
};

test('the card shows right after a link download of a video with no subtitles', () => {
  assert.equal(shouldShowDownloadHandoff(base), true);
});

test('the card hides whenever something else owns the next step', () => {
  const cases: Array<[string, Partial<typeof base>]> = [
    ['no handoff (not a link download)', { handoff: null as any }],
    [
      'dismissed for this video',
      { handoff: { ...ready, status: 'dismissed' } },
    ],
    ['subtitles already exist', { subtitleCount: 3 }],
    ['a job is running', { busy: true }],
    ['a free-preview offer stands', { previewStands: true }],
    ['an interrupted job waits', { interrupted: true }],
    ['the file cannot be read', { unreadable: true }],
    ['the first probe is still running', { checking: true }],
    ['no video is mounted', { hasVideo: false }],
  ];
  for (const [name, patch] of cases) {
    assert.equal(shouldShowDownloadHandoff({ ...base, ...patch }), false, name);
  }
});

test('the cost line uses the free-preview helper’s own figures', () => {
  const durationSecs = 600;
  // Covered by the welcome grant: says free.
  const covered = describeVideoCost({
    durationSecs,
    credits: creditsToStart(durationSecs, false) + 10,
    qualityEnabled: false,
  });
  assert.deepEqual(describeHandoffCost(covered, 'free'), {
    kind: 'covered',
    free: true,
  });
  assert.deepEqual(describeHandoffCost(covered, 'paid'), {
    kind: 'covered',
    free: false,
  });

  // Covers part of the video: the same minutes and price as the offer.
  const partial = describeVideoCost({
    durationSecs,
    credits: Math.floor(creditsToStart(durationSecs, false) / 3),
    qualityEnabled: false,
  });
  assert.equal(partial.kind, 'preview');
  const preview = describeHandoffCost(partial, 'freeThisMonth');
  assert.equal(preview.kind, 'preview');
  if (preview.kind === 'preview' && partial.kind === 'preview') {
    assert.equal(preview.free, true);
    assert.equal(preview.previewMinutes, partial.previewMinutes);
    assert.equal(preview.price, partial.wholeVideoPrice);
  }
});

test('under 45 s of balance the card is a purchase offer, never a free promise', () => {
  const durationSecs = 600;
  const offer = describeVideoCost({
    durationSecs,
    credits: Math.floor(creditsToStart(MIN_PREVIEW_SEC - 15, false) / 2),
    qualityEnabled: false,
  });
  assert.equal(offer.kind, 'offer');
  const cost = describeHandoffCost(offer, 'free');
  assert.equal(cost.kind, 'offer');
  assert.ok(!('free' in cost));
  assert.deepEqual(describeHandoffCost(offer, 'welcomePending'), {
    kind: 'offer',
    price: offer.kind === 'offer' ? offer.wholeVideoPrice : NaN,
    welcomePending: true,
  });
});

test('API keys or an unknown balance get no cost line', () => {
  assert.deepEqual(describeHandoffCost(null, 'free'), { kind: 'unknown' });
});

test('the saved line names the folder, not the whole path', () => {
  assert.equal(savedFolderName('/Users/a/Movies/clip.mp4'), 'Movies');
  assert.equal(savedFolderName('C:\\Users\\a\\Videos\\clip.mp4'), 'Videos');
});

test('a handoff is filed under the link, not a file path', () => {
  assert.equal(
    downloadHandoffKey({ sourceUrl: ' https://x.test/v ' }),
    'https://x.test/v'
  );
  assert.equal(downloadHandoffKey({ sourceUrl: null }), null);
});

test('"Not now" persists for the video; a re-download does not re-arm it', () => {
  const previous = globalThis.localStorage;
  let stored = '{}';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    },
  });
  try {
    const store = useDownloadHandoffStore;
    store.setState({ items: {} });
    store.getState().arm('https://x.test/v');
    store.getState().setSavedPath('https://x.test/v', '/Movies/v.mp4');
    assert.equal(
      store.getState().items['https://x.test/v']?.savedPath,
      '/Movies/v.mp4'
    );
    // Ready cards are not persisted; only the dismissal is.
    assert.deepEqual(JSON.parse(stored), {});
    store.getState().dismiss('https://x.test/v');
    assert.equal(JSON.parse(stored)['https://x.test/v'].status, 'dismissed');
    // No path or title is written for a dismissal.
    assert.deepEqual(
      Object.keys(JSON.parse(stored)['https://x.test/v']).sort(),
      ['status', 'updatedAt']
    );
    store.getState().arm('https://x.test/v');
    assert.equal(
      store.getState().items['https://x.test/v']?.status,
      'dismissed'
    );
    // A run starting consumes a ready card but never a dismissal.
    store.getState().arm('https://x.test/w');
    store.getState().consume('https://x.test/w');
    assert.equal(store.getState().items['https://x.test/w'], undefined);
    store.getState().consume('https://x.test/v');
    assert.equal(
      store.getState().items['https://x.test/v']?.status,
      'dismissed'
    );
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previous,
    });
  }
});

// Regression: "Download only" saves a copy and re-points the mounted video at
// it. The new path had no probe result, so the workspace counted the file as
// still being read and the card vanished a few seconds after it appeared.
test('saving the download keeps the card: the probe carries to the saved copy', () => {
  const before = {
    activeTrack: 'original' as const,
    metaPath: '/tmp-dl/download_1_x.mp4',
    metaError: null,
  };
  const after = carryProbeToSavedCopy(
    before,
    '/tmp-dl/download_1_x.mp4',
    '/Movies/x.mp4'
  );
  assert.equal(after.metaPath, '/Movies/x.mp4');
  assert.equal(after.needsProbe, false);
  // The same visibility rule the workspace uses for "checking".
  const checking = after.metaPath !== '/Movies/x.mp4';
  assert.equal(
    shouldShowDownloadHandoff({ ...base, checking }),
    true,
    'card stays after Save As'
  );
});

test('a save that lands before the first probe asks for a probe of the copy', () => {
  const after = carryProbeToSavedCopy(
    { activeTrack: 'original', metaPath: null, metaError: null },
    '/tmp-dl/download_1_x.mp4',
    '/Movies/x.mp4'
  );
  assert.equal(after.needsProbe, true);
  const unreadable = carryProbeToSavedCopy(
    {
      activeTrack: 'original',
      metaPath: null,
      metaError: { path: '/tmp-dl/download_1_x.mp4', code: 'probe-error' },
    },
    '/tmp-dl/download_1_x.mp4',
    '/Movies/x.mp4'
  );
  assert.deepEqual(unreadable.metaError, {
    path: '/Movies/x.mp4',
    code: 'probe-error',
  });
  assert.equal(unreadable.needsProbe, false);
  // Playing the dub: the mounted path is not the saved original.
  const dubbed = carryProbeToSavedCopy(
    { activeTrack: 'dubbed', metaPath: '/dub.mp4', metaError: null },
    '/tmp-dl/download_1_x.mp4',
    '/Movies/x.mp4'
  );
  assert.equal(dubbed.metaPath, '/dub.mp4');
  assert.equal(dubbed.needsProbe, false);
});

test('the button says "free" only for free minutes, and names how far a partial run goes', () => {
  assert.equal(
    handoffPrimaryLabel({
      kind: 'preview',
      free: true,
      previewMinutes: 4,
      price: 5,
    }),
    'firstMinutesFree'
  );
  assert.equal(
    handoffPrimaryLabel({
      kind: 'preview',
      free: false,
      previewMinutes: 4,
      price: 5,
    }),
    'firstMinutes'
  );
  assert.equal(
    handoffPrimaryLabel({ kind: 'offer', price: 5, welcomePending: false }),
    'buy'
  );
  assert.equal(handoffPrimaryLabel({ kind: 'covered', free: true }), 'watch');
  assert.equal(handoffPrimaryLabel({ kind: 'unknown' }), 'watch');
  // Paid balances never map to the free wording.
  const paidPartial = describeHandoffCost(
    { kind: 'preview', previewMinutes: 3, wholeVideoPrice: 4.99 },
    'paid'
  );
  assert.equal(handoffPrimaryLabel(paidPartial), 'firstMinutes');
  const monthlyPartial = describeHandoffCost(
    { kind: 'preview', previewMinutes: 3, wholeVideoPrice: 4.99 },
    'freeThisMonth'
  );
  assert.equal(handoffPrimaryLabel(monthlyPartial), 'firstMinutesFree');
});

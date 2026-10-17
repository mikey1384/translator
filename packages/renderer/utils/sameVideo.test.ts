import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadKeepsFileOpenedSubtitles,
  durationsLookLikeSameVideo,
} from './sameVideo.js';

test('only files of the same length count as the same video', () => {
  assert.equal(durationsLookLikeSameVideo(19.02, 19.5), true);
  assert.equal(durationsLookLikeSameVideo(19, 20), true);
  assert.equal(durationsLookLikeSameVideo(19, 21), false);
  assert.equal(durationsLookLikeSameVideo(null, 19), false);
  assert.equal(durationsLookLikeSameVideo(19, undefined), false);
  assert.equal(durationsLookLikeSameVideo(0, 0), false);
});

test('the Change Video choice wins over file-opened subtitles', () => {
  const fileOpened = {
    subtitleCount: 3,
    origin: 'disk',
    libraryEntryId: null,
  } as const;
  assert.equal(
    downloadKeepsFileOpenedSubtitles({ ...fileOpened, replaceCurrent: false }),
    true
  );
  assert.equal(
    downloadKeepsFileOpenedSubtitles({ ...fileOpened, replaceCurrent: true }),
    false
  );
  assert.equal(
    downloadKeepsFileOpenedSubtitles({
      ...fileOpened,
      origin: 'fresh',
      replaceCurrent: false,
    }),
    false
  );
  assert.equal(
    downloadKeepsFileOpenedSubtitles({
      ...fileOpened,
      libraryEntryId: 'entry-1',
      replaceCurrent: false,
    }),
    false
  );
});

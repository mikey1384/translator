import assert from 'node:assert/strict';
import test from 'node:test';
import { durationsLookLikeSameVideo } from './sameVideo.js';

test('only files of the same length count as the same video', () => {
  assert.equal(durationsLookLikeSameVideo(19.02, 19.5), true);
  assert.equal(durationsLookLikeSameVideo(19, 20), true);
  assert.equal(durationsLookLikeSameVideo(19, 21), false);
  assert.equal(durationsLookLikeSameVideo(null, 19), false);
  assert.equal(durationsLookLikeSameVideo(19, undefined), false);
  assert.equal(durationsLookLikeSameVideo(0, 0), false);
});

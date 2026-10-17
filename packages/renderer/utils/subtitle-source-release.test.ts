import test from 'node:test';
import assert from 'node:assert/strict';
import { subtitlesBelongToOtherSource } from './subtitle-source-release';

const cues = { order: ['a', 'b'] };

test('subtitles of another video are released', () => {
  assert.equal(
    subtitlesBelongToOtherSource(
      { ...cues, sourceVideoPath: '/v/clip.mp4' },
      { sourceVideoPath: '/v/other.mp4' }
    ),
    true
  );
});

test('subtitles of the same video (path, identity or link) stay', () => {
  assert.equal(
    subtitlesBelongToOtherSource(
      { ...cues, sourceVideoPath: '/V/Clip.mp4' },
      { sourceVideoPath: '/v/clip.mp4' }
    ),
    false
  );
  assert.equal(
    subtitlesBelongToOtherSource(
      { ...cues, sourceVideoPath: '/old/a.mp4', sourceVideoAssetIdentity: 'x' },
      { sourceVideoPath: '/new/a.mp4', sourceVideoAssetIdentity: 'x' }
    ),
    false
  );
  assert.equal(
    subtitlesBelongToOtherSource(
      { ...cues, sourceVideoPath: '/d/1.mp4', sourceUrl: 'https://y/1' },
      { sourceVideoPath: '/d/2.mp4', sourceUrl: 'https://y/1' }
    ),
    false
  );
});

test('an .srt tied to no video stays, and nothing mounted is a no-op', () => {
  assert.equal(
    subtitlesBelongToOtherSource(cues, { sourceVideoPath: '/v/a.mp4' }),
    false
  );
  assert.equal(
    subtitlesBelongToOtherSource(
      { order: [], sourceVideoPath: '/v/x.mp4' },
      { sourceVideoPath: '/v/a.mp4' }
    ),
    false
  );
});

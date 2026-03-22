import test from 'node:test';
import assert from 'node:assert/strict';

import { mountedSubtitleMatchesVideoSource } from './subtitle-source-association';

test('document-backed subtitles still count as belonging to the current video without a library link', () => {
  const matches = mountedSubtitleMatchesVideoSource(
    {
      order: ['seg-1'],
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
    },
    {
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
    }
  );

  assert.equal(matches, true);
});

test('subtitle ownership check rejects subtitles from another video', () => {
  const matches = mountedSubtitleMatchesVideoSource(
    {
      order: ['seg-1'],
      sourceVideoPath: '/Users/test/Videos/other.mp4',
      sourceVideoAssetIdentity: 'asset:999',
    },
    {
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
    }
  );

  assert.equal(matches, false);
});

test('subtitle ownership check rejects path-only matches when asset identities conflict', () => {
  const matches = mountedSubtitleMatchesVideoSource(
    {
      order: ['seg-1'],
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:old',
    },
    {
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:new',
    }
  );

  assert.equal(matches, false);
});

test('subtitle ownership check still allows legacy path matches when no asset identity is available', () => {
  const matches = mountedSubtitleMatchesVideoSource(
    {
      order: ['seg-1'],
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: null,
    },
    {
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:new',
    }
  );

  assert.equal(matches, true);
});

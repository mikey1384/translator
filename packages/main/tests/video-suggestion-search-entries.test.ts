import test from 'node:test';
import assert from 'node:assert/strict';
import { isYoutubeVideoEntry } from '../services/video-suggestions/shared.js';

test('flat search rows for playlists and channels are not videos', () => {
  const playlist = {
    _type: 'url',
    ie_key: 'YoutubeTab',
    id: 'PL6B3937A5D230E335',
    url: 'https://www.youtube.com/playlist?list=PL6B3937A5D230E335',
    title: 'Official Blender Open Movies',
  };
  const channel = {
    _type: 'url',
    ie_key: 'YoutubeTab',
    id: 'UCz75RVbH8q2jdBJ4SnwuZZQ',
    url: 'https://www.youtube.com/channel/UCz75RVbH8q2jdBJ4SnwuZZQ',
    title: 'Blender Studio',
  };
  const bareChannelId = { id: 'UCz75RVbH8q2jdBJ4SnwuZZQ', title: 'x' };
  for (const row of [playlist, channel, bareChannelId]) {
    assert.equal(isYoutubeVideoEntry(row), false);
  }
});

test('flat search rows for videos are kept', () => {
  const video = {
    _type: 'url',
    ie_key: 'Youtube',
    id: 'jNQXAC9IVRw',
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    title: 'Me at the zoo',
  };
  assert.equal(isYoutubeVideoEntry(video), true);

  const short = {
    ie_key: 'Youtube',
    id: 'abcdefghijk',
    url: 'https://www.youtube.com/shorts/abcdefghijk',
  };
  assert.equal(isYoutubeVideoEntry(short), true);
});

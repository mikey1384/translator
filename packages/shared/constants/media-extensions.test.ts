import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIA_FILE_EXTENSIONS,
  hasMediaFileExtension,
  hasSubtitleFileExtension,
} from './media-extensions.js';

test('formats people drop can also be picked', () => {
  for (const ext of ['m4a', 'm4v', 'mts', 'opus', 'wmv', 'mp4', 'mp3']) {
    assert.ok((MEDIA_FILE_EXTENSIONS as readonly string[]).includes(ext), ext);
  }
});

test('media and subtitle names are recognised by extension', () => {
  assert.equal(hasMediaFileExtension('/Users/me/Voice Memo.M4A'), true);
  assert.equal(hasMediaFileExtension('C:\\clips\\take.mts'), true);
  assert.equal(hasMediaFileExtension('notes.txt'), false);
  assert.equal(hasMediaFileExtension('mp4'), false);
  assert.equal(hasSubtitleFileExtension('episode.SRT'), true);
  assert.equal(hasSubtitleFileExtension('episode.srt.mp4'), false);
});

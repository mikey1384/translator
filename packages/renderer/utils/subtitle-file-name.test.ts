import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestSubtitleFilePath } from './subtitle-file-name';

test('Save As suggests <video>.<language>.srt next to the video', () => {
  assert.equal(
    suggestSubtitleFilePath({
      videoPath: '/Users/me/Movies/tos30.mp4',
      language: 'korean',
    }),
    '/Users/me/Movies/tos30.korean.srt'
  );
  assert.equal(
    suggestSubtitleFilePath({
      videoPath: 'C:\\Videos\\clip.final.mkv',
      language: 'Chinese Simplified',
    }),
    'C:\\Videos\\clip.final.chinese-simplified.srt'
  );
});

test('no language, temp videos and titles', () => {
  assert.equal(
    suggestSubtitleFilePath({ videoPath: '/v/a.mp4', language: null }),
    '/v/a.srt'
  );
  assert.equal(
    suggestSubtitleFilePath({
      videoPath: '/tmp/translator-electron/My video.mp4',
      language: 'english',
      videoInTempFolder: true,
    }),
    'My video.english.srt'
  );
  assert.equal(
    suggestSubtitleFilePath({ title: 'What: is/this?', language: '' }),
    'What is this.srt'
  );
  assert.equal(suggestSubtitleFilePath({}), 'subtitles.srt');
});

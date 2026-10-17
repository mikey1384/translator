import assert from 'node:assert/strict';
import test from 'node:test';
import { fitPictureBox } from './picture-box.js';

const panel = { left: 100, top: 50, width: 800, height: 600 };
const hiddenAudio = { left: 0, top: 0, width: 0, height: 0 };

test('audio-only fits the export frame into the visible panel, not the 0x0 <audio>', () => {
  const box = fitPictureBox({
    mediaRect: hiddenAudio,
    panelRect: panel,
    intrinsicWidth: 1280,
    intrinsicHeight: 720,
    isAudioOnly: true,
  });
  assert.deepEqual(box, { left: 0, top: 75, width: 800, height: 450 });
});

test('a media element without a layout box falls back to the panel', () => {
  const box = fitPictureBox({
    mediaRect: hiddenAudio,
    panelRect: panel,
    intrinsicWidth: 1920,
    intrinsicHeight: 1080,
    isAudioOnly: false,
  });
  assert.equal(box.width, 800);
  assert.equal(box.height, 450);
});

test('a video letterboxes inside its own element box', () => {
  // A portrait video in a centered 400x600 <video> inside the panel.
  const box = fitPictureBox({
    mediaRect: { left: 300, top: 50, width: 400, height: 600 },
    panelRect: panel,
    intrinsicWidth: 720,
    intrinsicHeight: 1280,
    isAudioOnly: false,
  });
  assert.equal(box.left, 200 + (400 - 337.5) / 2);
  assert.equal(box.top, 0);
  assert.equal(box.height, 600);
  assert.equal(box.width, 337.5);
});

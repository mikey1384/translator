import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentPresetEncodePlan,
  canStreamCopyAgentPreset,
} from '../utils/agent-preset-encode.js';

const compliant1080pMaster = {
  format: 'mov,mp4,m4a,3gp,3g2,mj2',
  video: {
    codec: 'h264',
    pixel_format: 'yuv420p',
    width: 1920,
    height: 1080,
    frame_rate: 60,
    rotation: 0,
  },
  audio: {
    codec: 'aac',
    sample_rate: 48000,
  },
};

test('youtube_1080p stream-copy remuxes an already compliant 1080p60 H.264/AAC MP4 master', () => {
  assert.equal(
    canStreamCopyAgentPreset({
      preset: 'youtube_1080p',
      definition: { width: 1920, height: 1080, crf: 18, audioBitrate: '192k' },
      probe: compliant1080pMaster,
    }),
    true
  );

  const plan = buildAgentPresetEncodePlan({
    sourcePath: '/tmp/master.mp4',
    temporaryPath: '/tmp/out.partial.mp4',
    preset: 'youtube_1080p',
    definition: { width: 1920, height: 1080, crf: 18, audioBitrate: '192k' },
    probe: compliant1080pMaster,
    frameRate: 60,
    platform: 'darwin',
  });

  assert.equal(plan.mode, 'remux');
  assert.ok(plan.primaryArgs.includes('-c'));
  assert.ok(plan.primaryArgs.includes('copy'));
  assert.ok(plan.primaryArgs.includes('+faststart'));
  assert.equal(plan.fallbackArgs, undefined);
});

test('non-compliant masters or bitrate-capped presets refuse stream-copy and use VideoToolbox with x264 fallback on macOS', () => {
  // 4K master into youtube_1080p requires downscaling -> must encode
  const planDownscale = buildAgentPresetEncodePlan({
    sourcePath: '/tmp/4k.mp4',
    temporaryPath: '/tmp/1080.partial.mp4',
    preset: 'youtube_1080p',
    definition: { width: 1920, height: 1080, crf: 18, audioBitrate: '192k' },
    probe: {
      ...compliant1080pMaster,
      video: { ...compliant1080pMaster.video, width: 3840, height: 2160 },
    },
    frameRate: 60,
    platform: 'darwin',
  });
  assert.equal(planDownscale.mode, 'videotoolbox');
  assert.ok(planDownscale.primaryArgs.includes('h264_videotoolbox'));
  assert.ok(planDownscale.fallbackArgs?.includes('libx264'));

  // Non-yuv420p pixel format must not stream-copy
  assert.equal(
    canStreamCopyAgentPreset({
      preset: 'youtube_1080p',
      definition: { width: 1920, height: 1080, crf: 18, audioBitrate: '192k' },
      probe: {
        ...compliant1080pMaster,
        video: { ...compliant1080pMaster.video, pixel_format: 'yuv420p10le' },
      },
    }),
    false
  );

  // Bitrate-capped X preset must always encode
  assert.equal(
    canStreamCopyAgentPreset({
      preset: 'x_long_video_1080p',
      definition: {
        width: 1920,
        height: 1080,
        videoBitrate: '8M',
        audioBitrate: '192k',
      },
      probe: compliant1080pMaster,
    }),
    false
  );

  // Non-zero rotation must not stream-copy
  assert.equal(
    canStreamCopyAgentPreset({
      preset: 'youtube_1080p',
      definition: { width: 1920, height: 1080, crf: 18, audioBitrate: '192k' },
      probe: {
        ...compliant1080pMaster,
        video: { ...compliant1080pMaster.video, rotation: 90 },
      },
    }),
    false
  );
});

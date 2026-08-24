import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  inspectMp4FastStart,
  verifyPresetCompatibility,
} from '../utils/agent-output-compatibility.js';

function mp4Atom(type: string, payload = Buffer.alloc(0)): Buffer {
  const output = Buffer.alloc(8 + payload.length);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, 'ascii');
  payload.copy(output, 8);
  return output;
}

function compatibleProbe(overrides: Record<string, unknown> = {}) {
  return {
    path: '/tmp/output.mp4',
    modified_at: new Date(0).toISOString(),
    modified_time_ms: 0,
    format: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration_seconds: 60,
    bytes: 1_000_000,
    bit_rate: 1_000_000,
    video: {
      codec: 'h264',
      profile: 'High',
      pixel_format: 'yuv420p',
      bit_rate: 900_000,
      width: 1280,
      height: 720,
      frame_rate: 30,
      duration_seconds: 60,
    },
    audio: {
      codec: 'aac',
      profile: 'LC',
      sample_rate: 48_000,
      channels: 2,
      channel_layout: 'stereo',
      duration_seconds: 60,
    },
    stream_count: 2,
    fast_start: true,
    ...overrides,
  } as any;
}

test('platform presets fail verification without fast-start metadata', () => {
  const findings = verifyPresetCompatibility(
    compatibleProbe({ fast_start: false }),
    'youtube_1080p',
    'standard'
  );
  assert.ok(
    findings.some(
      finding =>
        finding.severity === 'error' &&
        finding.code === 'platform_fast_start_missing'
    )
  );
});

test('fast-start inspection parses top-level atoms instead of matching incidental text', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-mp4-atoms-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fastPath = path.join(root, 'fast.mp4');
  const slowPath = path.join(root, 'slow.mp4');
  const misleadingPath = path.join(root, 'misleading.mp4');
  await Promise.all([
    fs.writeFile(
      fastPath,
      Buffer.concat([mp4Atom('ftyp'), mp4Atom('moov'), mp4Atom('mdat')])
    ),
    fs.writeFile(
      slowPath,
      Buffer.concat([mp4Atom('ftyp'), mp4Atom('mdat'), mp4Atom('moov')])
    ),
    fs.writeFile(
      misleadingPath,
      Buffer.concat([
        mp4Atom('ftyp', Buffer.from('payload contains moov text')),
        mp4Atom('mdat'),
      ])
    ),
  ]);
  assert.equal(await inspectMp4FastStart(fastPath), true);
  assert.equal(await inspectMp4FastStart(slowPath), false);
  assert.equal(await inspectMp4FastStart(misleadingPath), false);
});

test('X presets require AAC-LC rather than merely any AAC profile', () => {
  const probe = compatibleProbe();
  probe.audio.profile = 'HE-AAC';
  const findings = verifyPresetCompatibility(
    probe,
    'x_long_video_720p',
    'standard'
  );
  assert.ok(
    findings.some(finding => finding.code === 'x_audio_profile_incompatible')
  );
});

test('low-resolution preview presets enforce their advertised dimensions', () => {
  const probe = compatibleProbe();
  probe.video.width = 1280;
  probe.video.height = 720;
  const findings = verifyPresetCompatibility(
    probe,
    'preview_low_resolution',
    'standard'
  );
  assert.ok(
    findings.some(finding => finding.code === 'preset_dimensions_too_large')
  );
});

test('platform validation fails closed when required media metadata is unknown', () => {
  const probe = compatibleProbe({ duration_seconds: null, bytes: null });
  probe.video.frame_rate = null;
  probe.audio.profile = null;
  const findings = verifyPresetCompatibility(
    probe,
    'youtube_1080p',
    'standard'
  );
  const codes = new Set(findings.map(finding => finding.code));
  assert.ok(codes.has('invalid_output_size'));
  assert.ok(codes.has('invalid_output_duration'));
  assert.ok(codes.has('invalid_video_frame_rate'));
  assert.ok(codes.has('youtube_audio_profile_incompatible'));
});

test('each named resolution preset enforces its own maximum dimensions', () => {
  const probe = compatibleProbe();
  probe.video.width = 1920;
  probe.video.height = 1080;
  const findings = verifyPresetCompatibility(
    probe,
    'x_long_video_720p',
    'premium'
  );
  assert.ok(
    findings.some(finding => finding.code === 'preset_dimensions_too_large')
  );
});

test('a short 1080p X upload does not incorrectly require Premium', () => {
  const findings = verifyPresetCompatibility(
    compatibleProbe({ duration_seconds: 120, bytes: 100_000_000 }),
    'x_long_video_1080p',
    'standard'
  );
  assert.equal(
    findings.some(finding => finding.code === 'x_premium_required_for_1080p'),
    false
  );
  assert.equal(
    findings.some(finding => finding.severity === 'error'),
    false
  );
});

test('X bitrate validation uses the video stream rather than total container bitrate', () => {
  const compatible = compatibleProbe({ bit_rate: 25_100_000 });
  compatible.video.bit_rate = 24_900_000;
  assert.equal(
    verifyPresetCompatibility(compatible, 'x_long_video_1080p', 'premium').some(
      finding => finding.code === 'x_bit_rate_too_high'
    ),
    false
  );

  compatible.video.bit_rate = 25_100_000;
  assert.equal(
    verifyPresetCompatibility(compatible, 'x_long_video_1080p', 'premium').some(
      finding => finding.code === 'x_bit_rate_too_high'
    ),
    true
  );
});

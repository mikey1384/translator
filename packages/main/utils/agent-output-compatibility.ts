import { promises as fs } from 'node:fs';
import path from 'node:path';

export type AgentMediaProbe = {
  format: string | null;
  duration_seconds: number | null;
  bytes: number | null;
  bit_rate: number | null;
  stream_count: number;
  fast_start: boolean | null;
  video: {
    codec: string | null;
    profile: string | null;
    pixel_format: string | null;
    bit_rate: number | null;
    width: number | null;
    height: number | null;
    frame_rate: number | null;
    duration_seconds: number | null;
  } | null;
  audio: {
    codec: string | null;
    profile: string | null;
    sample_rate: number | null;
    duration_seconds: number | null;
  } | null;
};

export type AgentCompatibilityFinding = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
};

const YOUTUBE_MAXIMUM_BYTES = 256_000_000_000;
const YOUTUBE_MAXIMUM_DURATION_SECONDS = 12 * 60 * 60;
const X_STANDARD_MAXIMUM_BYTES = 512_000_000;
const X_STANDARD_MAXIMUM_DURATION_SECONDS = 140;
const X_PREMIUM_MAXIMUM_BYTES = 16_000_000_000;
const X_PREMIUM_MAXIMUM_DURATION_SECONDS = 4 * 60 * 60;
const X_PREMIUM_MAXIMUM_1080P_DURATION_SECONDS = 2 * 60 * 60;
const X_MAXIMUM_FRAME_RATE = 40;
const X_MAXIMUM_BIT_RATE = 25_000_000;

export async function inspectMp4FastStart(
  filePath: string
): Promise<boolean | null> {
  if (path.extname(filePath).toLowerCase() !== '.mp4') return null;
  const handle = await fs.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    if (!Number.isSafeInteger(size) || size < 8) return false;
    const header = Buffer.alloc(16);
    let offset = 0;
    while (offset + 8 <= size) {
      const base = await handle.read(header, 0, 8, offset);
      if (base.bytesRead !== 8) return false;
      const atomType = header.toString('ascii', 4, 8);
      const size32 = header.readUInt32BE(0);
      let headerBytes = 8;
      let atomBytes: number;
      if (size32 === 1) {
        const extended = await handle.read(header, 8, 8, offset + 8);
        if (extended.bytesRead !== 8) return false;
        const extendedSize = header.readBigUInt64BE(8);
        if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return false;
        atomBytes = Number(extendedSize);
        headerBytes = 16;
      } else if (size32 === 0) {
        atomBytes = size - offset;
      } else {
        atomBytes = size32;
      }
      if (atomBytes < headerBytes || atomBytes > size - offset) return false;
      if (atomType === 'moov') return true;
      if (atomType === 'mdat') return false;
      offset += atomBytes;
    }
    return false;
  } finally {
    await handle.close();
  }
}

function verifyCommonCompatibility(
  probe: AgentMediaProbe
): AgentCompatibilityFinding[] {
  const findings: AgentCompatibilityFinding[] = [];
  if (!Number.isFinite(Number(probe.bytes)) || Number(probe.bytes) <= 0) {
    findings.push({
      severity: 'error',
      code: 'invalid_output_size',
      message: 'Output file size is missing or invalid.',
    });
  }
  if (
    !Number.isFinite(Number(probe.duration_seconds)) ||
    Number(probe.duration_seconds) <= 0
  ) {
    findings.push({
      severity: 'error',
      code: 'invalid_output_duration',
      message: 'Output duration is missing or invalid.',
    });
  }
  if (!probe.video) {
    findings.push({
      severity: 'error',
      code: 'missing_video_stream',
      message: 'Output has no video stream.',
    });
  }
  if (
    probe.video &&
    (!Number.isFinite(Number(probe.video.width)) ||
      Number(probe.video.width) <= 0 ||
      !Number.isFinite(Number(probe.video.height)) ||
      Number(probe.video.height) <= 0)
  ) {
    findings.push({
      severity: 'error',
      code: 'invalid_video_dimensions',
      message: 'Output video dimensions are missing or invalid.',
    });
  }
  if (
    probe.video &&
    (!Number.isFinite(Number(probe.video.frame_rate)) ||
      Number(probe.video.frame_rate) <= 0)
  ) {
    findings.push({
      severity: 'error',
      code: 'invalid_video_frame_rate',
      message: 'Output video frame rate is missing or invalid.',
    });
  }
  if (!probe.audio) {
    findings.push({
      severity: 'warning',
      code: 'missing_audio_stream',
      message: 'Output has no audio stream.',
    });
  }
  if (
    probe.video?.duration_seconds &&
    probe.audio?.duration_seconds &&
    Math.abs(probe.video.duration_seconds - probe.audio.duration_seconds) > 1
  ) {
    findings.push({
      severity: 'warning',
      code: 'audio_video_duration_mismatch',
      message: `Audio and video durations differ by ${Math.abs(
        probe.video.duration_seconds - probe.audio.duration_seconds
      ).toFixed(3)} seconds.`,
    });
  }
  if (
    probe.video?.codec &&
    !['h264', 'hevc', 'vp9', 'av1'].includes(probe.video.codec)
  ) {
    findings.push({
      severity: 'warning',
      code: 'uncommon_video_codec',
      message: `Video codec ${probe.video.codec} may not be accepted by every platform.`,
    });
  }
  if (
    probe.video?.pixel_format &&
    !['yuv420p', 'yuv420p10le'].includes(probe.video.pixel_format)
  ) {
    findings.push({
      severity: 'warning',
      code: 'uncommon_pixel_format',
      message: `Pixel format ${probe.video.pixel_format} may have limited platform compatibility.`,
    });
  }
  if (probe.fast_start === false) {
    findings.push({
      severity: 'warning',
      code: 'fast_start_missing',
      message: 'MP4 metadata is not positioned for progressive download.',
    });
  }
  return findings;
}

export function verifyPresetCompatibility(
  probe: AgentMediaProbe,
  preset: string | undefined,
  xAccountTier: 'standard' | 'premium'
): AgentCompatibilityFinding[] {
  const findings = verifyCommonCompatibility(probe);
  const addError = (code: string, message: string) =>
    findings.push({ severity: 'error', code, message });
  const addWarning = (code: string, message: string) =>
    findings.push({ severity: 'warning', code, message });
  if (!preset) return findings;

  if (
    (preset.startsWith('youtube_') || preset.startsWith('x_')) &&
    probe.fast_start !== true
  ) {
    addError(
      'platform_fast_start_missing',
      'Platform preset output must have its MP4 moov atom before media data for reliable progressive upload.'
    );
  }

  if (preset.startsWith('youtube_')) {
    if (
      !String(probe.format || '')
        .split(',')
        .includes('mp4')
    ) {
      addError(
        'youtube_container_incompatible',
        'YouTube preset output is not an MP4 container.'
      );
    }
    if (probe.video?.codec !== 'h264') {
      addError(
        'youtube_video_codec_incompatible',
        'YouTube preset output must use H.264 video.'
      );
    }
    if (probe.audio && probe.audio.codec !== 'aac') {
      addError(
        'youtube_audio_codec_incompatible',
        'YouTube preset output must use AAC audio.'
      );
    }
    if (
      probe.audio?.codec === 'aac' &&
      !/\bLC\b/i.test(String(probe.audio.profile || ''))
    ) {
      addError(
        'youtube_audio_profile_incompatible',
        `YouTube preset AAC audio must use the LC profile, not ${probe.audio.profile}.`
      );
    }
    if (probe.audio?.sample_rate && probe.audio.sample_rate !== 48_000) {
      addWarning(
        'youtube_audio_sample_rate',
        'YouTube recommends a 48 kHz audio sample rate.'
      );
    }
    if (Number(probe.bytes) > YOUTUBE_MAXIMUM_BYTES) {
      addError(
        'youtube_file_too_large',
        'YouTube uploads cannot exceed 256 GB.'
      );
    }
    if (Number(probe.duration_seconds) > YOUTUBE_MAXIMUM_DURATION_SECONDS) {
      addError(
        'youtube_duration_too_long',
        'YouTube uploads cannot exceed 12 hours.'
      );
    }
  }

  if (preset.startsWith('x_')) {
    const maximumBytes =
      xAccountTier === 'premium'
        ? X_PREMIUM_MAXIMUM_BYTES
        : X_STANDARD_MAXIMUM_BYTES;
    const maximumDuration =
      xAccountTier === 'premium'
        ? X_PREMIUM_MAXIMUM_DURATION_SECONDS
        : X_STANDARD_MAXIMUM_DURATION_SECONDS;
    if (
      !String(probe.format || '')
        .split(',')
        .includes('mp4')
    ) {
      addError(
        'x_container_incompatible',
        'X preset output is not an MP4 container.'
      );
    }
    if (probe.video?.codec !== 'h264') {
      addError(
        'x_video_codec_incompatible',
        'X preset output must use H.264 video.'
      );
    }
    if (probe.video?.pixel_format !== 'yuv420p') {
      addError('x_pixel_format_incompatible', 'X requires YUV 4:2:0 video.');
    }
    if (probe.audio && probe.audio.codec !== 'aac') {
      addError(
        'x_audio_codec_incompatible',
        'X preset output must use AAC-LC audio.'
      );
    }
    if (
      probe.audio?.codec === 'aac' &&
      !/\bLC\b/i.test(String(probe.audio.profile || ''))
    ) {
      addError(
        'x_audio_profile_incompatible',
        `X preset AAC audio must use the LC profile, not ${probe.audio.profile}.`
      );
    }
    if (Number(probe.video?.frame_rate) > X_MAXIMUM_FRAME_RATE) {
      addError('x_frame_rate_too_high', 'X web uploads cannot exceed 40 fps.');
    }
    const duration = Number(probe.duration_seconds);
    const bytes = Number(probe.bytes);
    const effectiveVideoBitRate =
      Number(probe.video?.bit_rate) > 0
        ? Number(probe.video?.bit_rate)
        : duration > 0 && bytes > 0
          ? (bytes * 8) / duration
          : null;
    if (
      effectiveVideoBitRate !== null &&
      effectiveVideoBitRate > X_MAXIMUM_BIT_RATE
    ) {
      addError('x_bit_rate_too_high', 'X web uploads cannot exceed 25 Mbps.');
    }
    if (Number(probe.bytes) > maximumBytes) {
      addError(
        'x_file_too_large',
        `This output exceeds the selected X ${xAccountTier} account file-size limit.`
      );
    }
    if (Number(probe.duration_seconds) > maximumDuration) {
      addError(
        'x_duration_too_long',
        `This output exceeds the selected X ${xAccountTier} account duration limit.`
      );
    }
    if (
      preset === 'x_long_video_1080p' &&
      xAccountTier === 'premium' &&
      Number(probe.duration_seconds) > X_PREMIUM_MAXIMUM_1080P_DURATION_SECONDS
    ) {
      addError(
        'x_1080p_duration_too_long',
        'X videos longer than two hours must be 720p.'
      );
    }
    const width = Number(probe.video?.width);
    const height = Number(probe.video?.height);
    if (width > 0 && height > 0) {
      const aspect = width / height;
      if (aspect < 1 / 2.39 || aspect > 2.39) {
        addError(
          'x_aspect_ratio_incompatible',
          'X requires an aspect ratio between 1:2.39 and 2.39:1.'
        );
      }
      const dimensionsAllowed =
        width >= height
          ? width <= 1920 && height <= 1200
          : width <= 1200 && height <= 1900;
      if (!dimensionsAllowed || width < 32 || height < 32) {
        addError(
          'x_dimensions_too_large',
          'X web upload dimensions exceed the supported landscape or portrait bounds.'
        );
      }
    }
  }

  const presetMaximumDimensions: Record<
    string,
    { width: number; height: number }
  > = {
    youtube_1080p: { width: 1920, height: 1080 },
    youtube_4k: { width: 3840, height: 2160 },
    x_long_video_720p: { width: 1280, height: 720 },
    x_long_video_1080p: { width: 1920, height: 1080 },
    preview_low_resolution: { width: 854, height: 480 },
  };
  const presetDimensions = presetMaximumDimensions[preset];
  if (
    presetDimensions &&
    (Number(probe.video?.width) > presetDimensions.width ||
      Number(probe.video?.height) > presetDimensions.height)
  ) {
    addError(
      'preset_dimensions_too_large',
      `${preset} output must fit within ${presetDimensions.width}×${presetDimensions.height}.`
    );
  }

  return findings;
}

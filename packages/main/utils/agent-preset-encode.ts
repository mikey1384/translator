export type AgentEncodingPresetName =
  | 'youtube_1080p'
  | 'youtube_4k'
  | 'x_long_video_720p'
  | 'x_long_video_1080p'
  | 'archive_master'
  | 'preview_low_resolution';

export interface AgentPresetDefinition {
  width?: number;
  height?: number;
  crf?: number;
  videoBitrate?: string;
  audioBitrate?: string;
}

export interface AgentPresetSourceProbe {
  format?: string | null;
  video?: {
    codec?: string | null;
    pixel_format?: string | null;
    width?: number | null;
    height?: number | null;
    frame_rate?: number | null;
    rotation?: number | null;
  } | null;
  audio?: {
    codec?: string | null;
    sample_rate?: number | null;
  } | null;
}

export interface AgentPresetEncodePlan {
  mode: 'remux' | 'videotoolbox' | 'libx264';
  primaryArgs: string[];
  fallbackArgs?: string[];
}

function isEvenPositive(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 2 &&
    Math.floor(value) === value &&
    value % 2 === 0
  );
}

/**
 * Strictly decide whether a burned-in MP4 master already satisfies a delivery
 * preset so we can stream-copy remux (`-c copy -movflags +faststart`) in
 * seconds instead of re-encoding on CPU.
 */
export function canStreamCopyAgentPreset({
  preset,
  definition,
  probe,
}: {
  preset: AgentEncodingPresetName;
  definition: AgentPresetDefinition;
  probe: AgentPresetSourceProbe;
}): boolean {
  // Bitrate-capped presets (X long video) and low-res previews always encode.
  if (definition.videoBitrate || preset === 'preview_low_resolution') {
    return false;
  }
  if (preset.startsWith('x_')) {
    return false;
  }

  const format = String(probe.format || '').toLowerCase();
  if (!format.includes('mp4')) {
    return false;
  }

  const video = probe.video;
  if (!video) return false;
  if (String(video.codec || '').toLowerCase() !== 'h264') {
    return false;
  }
  if (String(video.pixel_format || '').toLowerCase() !== 'yuv420p') {
    return false;
  }
  if (video.rotation && Number(video.rotation) !== 0) {
    return false;
  }
  if (!isEvenPositive(video.width) || !isEvenPositive(video.height)) {
    return false;
  }
  if (definition.width && video.width > definition.width) {
    return false;
  }
  if (definition.height && video.height > definition.height) {
    return false;
  }

  const audio = probe.audio;
  if (audio) {
    if (String(audio.codec || '').toLowerCase() !== 'aac') {
      return false;
    }
    const sampleRate = Number(audio.sample_rate || 0);
    if (sampleRate > 0 && sampleRate !== 48000 && sampleRate !== 44100) {
      return false;
    }
  }

  return true;
}

function buildLibx264Args({
  sourcePath,
  temporaryPath,
  preset,
  definition,
  filters,
}: {
  sourcePath: string;
  temporaryPath: string;
  preset: AgentEncodingPresetName;
  definition: AgentPresetDefinition;
  filters: string[];
}): string[] {
  return [
    '-y',
    '-i',
    sourcePath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-preset',
    preset === 'archive_master' ? 'medium' : 'veryfast',
    '-pix_fmt',
    'yuv420p',
    ...(definition.videoBitrate
      ? [
          '-b:v',
          definition.videoBitrate,
          '-maxrate',
          definition.videoBitrate,
          '-bufsize',
          `${Number.parseFloat(definition.videoBitrate) * 2}M`,
        ]
      : ['-crf', String(definition.crf ?? 20)]),
    '-c:a',
    'aac',
    '-b:a',
    definition.audioBitrate || '192k',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    temporaryPath,
  ];
}

function resolveVideoToolboxBitrate(
  preset: AgentEncodingPresetName,
  definition: AgentPresetDefinition
): string {
  if (definition.videoBitrate) return definition.videoBitrate;
  switch (preset) {
    case 'youtube_4k':
      return '35M';
    case 'archive_master':
      return '24M';
    case 'preview_low_resolution':
      return '1500k';
    case 'youtube_1080p':
    default:
      return '12M';
  }
}

export function buildAgentPresetEncodePlan({
  sourcePath,
  temporaryPath,
  preset,
  definition,
  probe,
  frameRate,
  platform = process.platform,
}: {
  sourcePath: string;
  temporaryPath: string;
  preset: AgentEncodingPresetName;
  definition: AgentPresetDefinition;
  probe: AgentPresetSourceProbe;
  frameRate?: number | null;
  platform?: NodeJS.Platform;
}): AgentPresetEncodePlan {
  if (canStreamCopyAgentPreset({ preset, definition, probe })) {
    return {
      mode: 'remux',
      primaryArgs: [
        '-y',
        '-i',
        sourcePath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        '-progress',
        'pipe:1',
        temporaryPath,
      ],
    };
  }

  const filters =
    definition.width && definition.height
      ? [
          `scale=w='min(iw,${definition.width})':h='min(ih,${definition.height})':force_original_aspect_ratio=decrease:force_divisible_by=2`,
          'setsar=1',
        ]
      : ['setsar=1'];
  if (preset.startsWith('x_') && Number(frameRate) > 30) {
    filters.push('fps=30');
  }

  const x264Args = buildLibx264Args({
    sourcePath,
    temporaryPath,
    preset,
    definition,
    filters,
  });

  if (platform === 'darwin') {
    const vtBitrate = resolveVideoToolboxBitrate(preset, definition);
    const vtArgs = [
      '-y',
      '-i',
      sourcePath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      filters.join(','),
      '-c:v',
      'h264_videotoolbox',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-b:v',
      vtBitrate,
      ...(definition.videoBitrate
        ? [
            '-maxrate',
            definition.videoBitrate,
            '-bufsize',
            `${Number.parseFloat(definition.videoBitrate) * 2}M`,
          ]
        : []),
      '-c:a',
      'aac',
      '-b:a',
      definition.audioBitrate || '192k',
      '-ar',
      '48000',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      temporaryPath,
    ];
    return {
      mode: 'videotoolbox',
      primaryArgs: vtArgs,
      fallbackArgs: x264Args,
    };
  }

  return {
    mode: 'libx264',
    primaryArgs: x264Args,
  };
}

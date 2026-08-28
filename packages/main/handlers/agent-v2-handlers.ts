import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { FFmpegContext } from '../services/ffmpeg-runner.js';
import { STAGE5_API_URL } from '../services/endpoints.js';
import {
  getActiveProviderForAudio,
  getActiveProviderForDubbing,
  getActiveProviderForModel,
  getStage5DubbingTtsProvider,
  getSummaryModelConfig,
  getVideoSuggestionModelPreference,
  resolveTranslationDraftModel,
  resolveVideoSuggestionModel,
} from '../services/ai-provider.js';
import { ensureYtDlpBinary } from '../services/url-processor/binary-installer.js';
import { getDeviceId } from './credit-handlers.js';
import { settingsStore } from '../store/settings-store.js';
import { assertAgentOutputPathAuthorized } from '../utils/agent-output-authorization.js';
import {
  inspectMp4FastStart,
  verifyPresetCompatibility,
} from '../utils/agent-output-compatibility.js';
import {
  assertAgentOutputDoesNotReferenceProtectedInputs,
  assertAgentOperationId,
  cleanAgentOutputBaseName,
  fingerprintAgentOutputFile,
  getAgentOutputReceiptPath,
  isAgentTemporaryMasterPath,
  normalizeAgentOutputPathIdentity,
  pathsReferenceSameFile,
  publishAgentOutputFile,
  readAgentOutputReceipt,
  readStableBoundedUtf8File,
  readAgentTemporaryOutputReceiptMetadata,
  readAgentTemporaryOutputReservation,
  writeAgentOutputReceipt,
  writeAgentTemporaryOutputReservation,
} from '../utils/agent-output-receipt.js';
import { getAssetsPath } from '../../shared/helpers/paths.js';
import {
  boundedMetadataText,
  boundedSourceIdentity,
  finitePositiveMetadataNumber,
  safeHttpMetadataUrl,
} from '../utils/agent-source-metadata.js';
import { assertSubtitleRenderFontReadable } from '../utils/subtitle-render-font.js';
import { MAX_SUBTITLE_OUTPUT_FONT_SIZE } from '../../shared/helpers/subtitle-render-spec.js';
import { MIN_SUBTITLE_FONT_SIZE } from '../../shared/constants/runtime-config.js';
import {
  parseExpectedAgentFileFingerprint,
  verifyAgentTranscodeSourceSnapshot,
} from '../utils/agent-transcode-source.js';

const execFileAsync = promisify(execFile);
const MAX_PROBE_BUFFER_BYTES = 24 * 1024 * 1024;
const MAX_AGENT_TEXT_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_CAPTION_BYTES = 32 * 1024 * 1024;
const MOCK_MEDIA_VERSION = 1;
const MOCK_MEDIA_DURATION_SECONDS = 12;
const activeTranscodeOutputPaths = new Set<string>();
const activeTextOutputPaths = new Set<string>();
let mockMediaPromise: Promise<string> | null = null;

type AgentV2Services = { ffmpeg: FFmpegContext };

type AgentEncodingPreset =
  | 'youtube_1080p'
  | 'youtube_4k'
  | 'x_long_video_720p'
  | 'x_long_video_1080p'
  | 'archive_master'
  | 'preview_low_resolution';

function maskedDeviceReference(): string {
  const digest = createHash('sha256').update(getDeviceId()).digest('hex');
  return `device:${digest.slice(0, 12)}`;
}

function configuredAllowedDirectories(): string[] {
  const configured = settingsStore.get('agentAllowedDirectories', []);
  return Array.isArray(configured) && configured.length
    ? configured.filter((item): item is string => typeof item === 'string')
    : [
        app.getPath('downloads'),
        path.join(app.getPath('userData'), 'url-downloads'),
      ];
}

function apiKeyModeEnabled(): boolean {
  return settingsStore.get('useByoMaster', false) === true;
}

function providerDescriptor(
  provider: string,
  model: string | null = null
): Record<string, unknown> {
  if (provider === 'stage5') {
    if (apiKeyModeEnabled()) {
      return {
        kind: 'unavailable',
        provider,
        model,
        stage5_credits: false,
        reason:
          'API-key mode forbids automatic fallback to Stage5 credits, but no usable BYO route is active.',
      };
    }
    return { kind: 'stage5', provider, model, stage5_credits: true };
  }
  return { kind: 'byo', provider, model, stage5_credits: false };
}

function authoritativeProviderContext(): Record<string, unknown> {
  const translationModel = resolveTranslationDraftModel();
  const summaryStandard = getSummaryModelConfig('standard');
  const summaryHigh = getSummaryModelConfig('high');
  const transcriptionProvider = getActiveProviderForAudio();
  const dubbingProvider = getActiveProviderForDubbing();
  const videoSuggestionModel = resolveVideoSuggestionModel(
    getVideoSuggestionModelPreference()
  );
  return {
    api_key_mode: apiKeyModeEnabled(),
    transcription: providerDescriptor(transcriptionProvider),
    translation: providerDescriptor(
      getActiveProviderForModel(translationModel),
      translationModel
    ),
    summary: providerDescriptor(
      summaryStandard.provider,
      summaryStandard.model
    ),
    summary_high: providerDescriptor(summaryHigh.provider, summaryHigh.model),
    dubbing: providerDescriptor(
      dubbingProvider,
      dubbingProvider === 'stage5' ? getStage5DubbingTtsProvider() : null
    ),
    video_suggestions: providerDescriptor(
      getActiveProviderForModel(videoSuggestionModel),
      videoSuggestionModel
    ),
  };
}

function parseRate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const [numerator, denominator] = value.split('/').map(Number);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return numerator / denominator;
}

function stableFileSnapshot(stat: fsSync.BigIntStats): string[] {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(
    value => String(value)
  );
}

function sameFileSnapshot(
  left: fsSync.BigIntStats,
  right: fsSync.BigIntStats
): boolean {
  const leftSnapshot = stableFileSnapshot(left);
  const rightSnapshot = stableFileSnapshot(right);
  return leftSnapshot.every((value, index) => value === rightSnapshot[index]);
}

async function detailedProbe(ffprobePath: string, filePath: string) {
  const before = await fs.stat(filePath, { bigint: true });
  if (!before.isFile())
    throw new Error(`Media probe target is not a file: ${filePath}`);
  const { stdout } = await execFileAsync(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,size,bit_rate,format_name:stream=index,codec_type,codec_name,profile,pix_fmt,width,height,bit_rate,r_frame_rate,avg_frame_rate,duration,sample_rate,channels,channel_layout:stream_tags=language',
      '-of',
      'json',
      filePath,
    ],
    { windowsHide: true, maxBuffer: MAX_PROBE_BUFFER_BYTES, encoding: 'utf8' }
  );
  const parsed = JSON.parse(stdout);
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video =
    streams.find((stream: any) => stream.codec_type === 'video') || null;
  const audio =
    streams.find((stream: any) => stream.codec_type === 'audio') || null;
  const fastStart = await inspectMp4FastStart(filePath);
  const after = await fs.stat(filePath, { bigint: true });
  if (!after.isFile() || !sameFileSnapshot(before, after)) {
    throw new Error(`Media changed while Translator probed it: ${filePath}`);
  }
  return {
    path: filePath,
    modified_at: new Date(Number(after.mtimeNs) / 1_000_000).toISOString(),
    modified_time_ms: Number(after.mtimeNs) / 1_000_000,
    format: parsed.format?.format_name || null,
    duration_seconds: Number(parsed.format?.duration) || null,
    bytes: Number(after.size),
    bit_rate: Number(parsed.format?.bit_rate) || null,
    video: video
      ? {
          codec: video.codec_name || null,
          profile: video.profile || null,
          pixel_format: video.pix_fmt || null,
          bit_rate: Number(video.bit_rate) || null,
          width: Number(video.width) || null,
          height: Number(video.height) || null,
          frame_rate:
            parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate),
          duration_seconds: Number(video.duration) || null,
        }
      : null,
    audio: audio
      ? {
          codec: audio.codec_name || null,
          profile: audio.profile || null,
          sample_rate: Number(audio.sample_rate) || null,
          channels: Number(audio.channels) || null,
          channel_layout: audio.channel_layout || null,
          duration_seconds: Number(audio.duration) || null,
        }
      : null,
    stream_count: streams.length,
    fast_start: fastStart,
  };
}

function isUsableMockProbe(probe: Awaited<ReturnType<typeof detailedProbe>>) {
  return Boolean(
    probe.video?.codec === 'h264' &&
    probe.audio?.codec === 'aac' &&
    Number(probe.duration_seconds) >= MOCK_MEDIA_DURATION_SECONDS - 0.25 &&
    Number(probe.duration_seconds) <= MOCK_MEDIA_DURATION_SECONDS + 0.25
  );
}

async function ensureMockMedia(ffmpeg: FFmpegContext): Promise<string> {
  if (mockMediaPromise) return mockMediaPromise;
  const active = (async () => {
    const userDataDirectory = await fs.realpath(app.getPath('userData'));
    const requestedDirectory = path.join(
      userDataDirectory,
      'agent',
      `mock-v${MOCK_MEDIA_VERSION}`
    );
    await fs.mkdir(requestedDirectory, { recursive: true, mode: 0o700 });
    const directory = await fs.realpath(requestedDirectory);
    const relative = path.relative(userDataDirectory, directory);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        'The durable MCP mock-media directory escaped user data.'
      );
    }
    const outputPath = path.join(directory, 'translator-mcp-sample.mp4');
    const existing = await fs.lstat(outputPath).catch(() => null);
    if (existing?.isFile() && !existing.isSymbolicLink()) {
      const probe = await detailedProbe(ffmpeg.ffprobePath, outputPath).catch(
        () => null
      );
      if (probe && isUsableMockProbe(probe)) return outputPath;
    } else if (existing) {
      throw new Error('The durable MCP mock-media path is not a regular file.');
    }

    const temporaryPath = path.join(
      directory,
      `.translator-mcp-sample.${process.pid}.${randomUUID()}.partial.mp4`
    );
    try {
      await ffmpeg.run(
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          `testsrc2=duration=${MOCK_MEDIA_DURATION_SECONDS}:size=640x360:rate=30`,
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=440:sample_rate=48000:duration=${MOCK_MEDIA_DURATION_SECONDS}`,
          '-shortest',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '96k',
          '-ar',
          '48000',
          '-movflags',
          '+faststart',
          temporaryPath,
        ],
        { operationId: `mcp-v2:mock-media:v${MOCK_MEDIA_VERSION}` }
      );
      const generated = await detailedProbe(ffmpeg.ffprobePath, temporaryPath);
      if (!isUsableMockProbe(generated)) {
        throw new Error('Translator generated an invalid MCP sample clip.');
      }
      await publishAgentOutputFile({
        temporaryPath,
        outputPath,
        overwrite: true,
      });
      await fs.chmod(outputPath, 0o600).catch(() => undefined);
      return outputPath;
    } finally {
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
  })();
  mockMediaPromise = active;
  try {
    return await active;
  } finally {
    if (mockMediaPromise === active) mockMediaPromise = null;
  }
}

type RepresentativeFrameInput = {
  videoPath?: string;
  outputDirectory?: string;
  baseName?: string;
  overwrite?: boolean;
  positionsSeconds?: number[];
  operationId?: string;
  protectedPaths?: string[];
  srtContent?: string;
  requireSubtitles?: boolean;
  subtitleStyle?: 'Default' | 'Classic' | 'Boxed' | 'LineBox';
  subtitleFontSize?: number;
  receiptKindPrefix?: string;
};

async function renderRepresentativeFrames(
  ffmpeg: FFmpegContext,
  input: RepresentativeFrameInput
) {
  const requestedVideoPath = path.resolve(String(input?.videoPath || ''));
  const outputDirectory = path.resolve(String(input?.outputDirectory || ''));
  if (
    !String(input?.videoPath || '').trim() ||
    !String(input?.outputDirectory || '').trim()
  ) {
    throw new Error(
      'Representative frame rendering requires a video and output directory.'
    );
  }
  const videoPath = await fs.realpath(requestedVideoPath);
  const videoBefore = await fs.stat(videoPath, { bigint: true });
  if (!videoBefore.isFile()) {
    throw new Error('Representative frame source is not a regular file.');
  }
  const outputDirectoryStat = await fs.stat(outputDirectory);
  if (!outputDirectoryStat.isDirectory()) {
    throw new Error('Representative frame output directory does not exist.');
  }

  const srtContent = String(input?.srtContent || '');
  const burnSubtitles = Boolean(srtContent.trim());
  if (input?.requireSubtitles === true && !burnSubtitles) {
    throw new Error('Preview rendering requires subtitles.');
  }
  const metadata = await ffmpeg.getVideoMetadata(videoPath);
  const mediaDuration = Number(metadata.duration);
  if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) {
    throw new Error('Representative frame source has no valid media duration.');
  }
  const requestedPositions =
    Array.isArray(input?.positionsSeconds) && input.positionsSeconds.length
      ? input.positionsSeconds.slice(0, 3)
      : [mediaDuration * 0.1, mediaDuration * 0.5, mediaDuration * 0.9];
  const lastFrameSecond = Math.max(0, mediaDuration - 0.001);
  const positions = requestedPositions.map(value =>
    Math.min(
      lastFrameSecond,
      Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0)
    )
  );
  const subtitleStyle = input?.subtitleStyle || 'Default';
  const styleDetails = {
    Default: 'Outline=2,Shadow=1,BorderStyle=1',
    Classic: 'Outline=3,Shadow=2,BorderStyle=1',
    Boxed: 'Outline=1,Shadow=0,BorderStyle=3,BackColour=&H90000000',
    LineBox: 'Outline=2,Shadow=0,BorderStyle=3,BackColour=&H70000000',
  }[subtitleStyle];
  if (!styleDetails) throw new Error('Unsupported subtitle preview style.');
  const fontSize = Math.max(
    MIN_SUBTITLE_FONT_SIZE,
    Math.min(
      MAX_SUBTITLE_OUTPUT_FONT_SIZE,
      Number(input?.subtitleFontSize) || 24
    )
  );
  const baseName = cleanAgentOutputBaseName(
    input?.baseName,
    burnSubtitles ? 'translator-preview' : 'translator-verified-frame'
  );
  const operationId = assertAgentOperationId(input?.operationId);
  const receiptKindPrefix = String(
    input?.receiptKindPrefix ||
      (burnSubtitles ? 'preview_frame' : 'verified_output_frame')
  );
  if (!/^[a-z0-9_]{1,80}$/.test(receiptKindPrefix)) {
    throw new Error('Representative frame receipt kind is invalid.');
  }

  let tempSrt: string | null = null;
  let subtitleFilter: string | null = null;
  if (burnSubtitles) {
    const renderFont = await assertSubtitleRenderFontReadable(
      getAssetsPath('NotoSans-Regular.ttf')
    );
    tempSrt = path.join(ffmpeg.tempDir, `mcp-preview-${randomUUID()}.srt`);
    await fs.writeFile(tempSrt, srtContent, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    const escapedSubtitlePath = tempSrt
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'");
    const escapedFontsDirectory = path
      .dirname(renderFont.path)
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'");
    subtitleFilter = `subtitles='${escapedSubtitlePath}':fontsdir='${escapedFontsDirectory}':force_style='FontName=Noto Sans,FontSize=${fontSize},${styleDetails},Alignment=2,MarginV=40'`;
  }

  const frames: string[] = [];
  const artifacts: Array<Record<string, unknown>> = [];
  try {
    for (let index = 0; index < positions.length; index += 1) {
      const requested = path.join(
        outputDirectory,
        `${baseName}-${index + 1}.png`
      );
      const outputPath = assertAgentOutputPathAuthorized(
        requested,
        'Representative frame'
      );
      const outputPathIdentity = normalizeAgentOutputPathIdentity(outputPath);
      await assertAgentOutputDoesNotReferenceProtectedInputs(
        outputPath,
        input?.protectedPaths
      );
      const frameOperationId = assertAgentOperationId(
        `${operationId}-${index + 1}`
      );
      const frameReceiptKind = `${receiptKindPrefix}_${index + 1}`;
      const reusable = await readAgentOutputReceipt({
        outputPath,
        operationId: frameOperationId,
        kind: frameReceiptKind,
      });
      if (reusable) {
        frames.push(outputPath);
        artifacts.push({
          path: outputPath,
          operation_id: frameOperationId,
          kind: frameReceiptKind,
          bytes: reusable.bytes,
          sha256: reusable.sha256,
          reused: true,
        });
        continue;
      }
      if (activeTranscodeOutputPaths.has(outputPathIdentity)) {
        throw new Error(
          `Another Translator operation is already writing this representative frame: ${outputPath}`
        );
      }
      if (!input?.overwrite && (await fs.lstat(outputPath).catch(() => null))) {
        throw new Error(`Representative frame already exists: ${outputPath}`);
      }
      const temporaryPath = assertAgentOutputPathAuthorized(
        path.join(
          outputDirectory,
          `.${path.basename(outputPath)}.${process.pid}.${randomUUID()}.partial.png`
        ),
        'Representative frame temporary file'
      );
      activeTranscodeOutputPaths.add(outputPathIdentity);
      try {
        await ffmpeg.run(
          [
            '-y',
            '-ss',
            String(Math.max(0, Number(positions[index]) || 0)),
            '-i',
            videoPath,
            ...(subtitleFilter ? ['-vf', subtitleFilter] : []),
            '-frames:v',
            '1',
            '-q:v',
            '2',
            temporaryPath,
          ],
          { operationId: frameOperationId }
        );
        const videoAfterFrame = await fs.stat(videoPath, { bigint: true });
        if (
          !videoAfterFrame.isFile() ||
          !sameFileSnapshot(videoBefore, videoAfterFrame)
        ) {
          throw new Error(
            'Media changed while a representative frame was being rendered.'
          );
        }
        const fingerprint = await fingerprintAgentOutputFile(temporaryPath);
        await writeAgentOutputReceipt({
          outputPath,
          operationId: frameOperationId,
          kind: frameReceiptKind,
          bytes: fingerprint.bytes,
          sha256: fingerprint.sha256,
          authorizePath: assertAgentOutputPathAuthorized,
        });
        await publishAgentOutputFile({
          temporaryPath,
          outputPath,
          overwrite: input?.overwrite === true,
        });
        frames.push(outputPath);
        artifacts.push({
          path: outputPath,
          operation_id: frameOperationId,
          kind: frameReceiptKind,
          bytes: fingerprint.bytes,
          sha256: fingerprint.sha256,
          reused: false,
        });
      } finally {
        activeTranscodeOutputPaths.delete(outputPathIdentity);
        await fs.unlink(temporaryPath).catch(() => undefined);
      }
    }
    const videoAfter = await fs.stat(videoPath, { bigint: true });
    if (!sameFileSnapshot(videoBefore, videoAfter)) {
      throw new Error(
        'Media changed while representative frames were being rendered.'
      );
    }
  } finally {
    if (tempSrt) await fs.unlink(tempSrt).catch(() => undefined);
  }
  return {
    frames,
    artifacts,
    positions_seconds: positions,
    subtitles_burned_for_preview: burnSubtitles,
    ...(burnSubtitles
      ? {
          style: subtitleStyle,
          font: 'Noto Sans',
          font_size: fontSize,
        }
      : {}),
  };
}

async function probeUrl(urlValue: unknown) {
  const parsed = new URL(String(urlValue || ''));
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https source URLs are supported.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Source URLs cannot contain embedded credentials.');
  }
  const binary = await ensureYtDlpBinary({ skipUpdate: true });
  const { stdout } = await execFileAsync(
    binary,
    [
      '--ignore-config',
      '--skip-download',
      '--dump-single-json',
      '--no-warnings',
      '--no-playlist',
      parsed.toString(),
    ],
    { windowsHide: true, maxBuffer: MAX_PROBE_BUFFER_BYTES, encoding: 'utf8' }
  );
  const metadata = JSON.parse(stdout);
  const exactBytes = finitePositiveMetadataNumber(metadata.filesize, {
    integer: true,
  });
  const approximateBytes = finitePositiveMetadataNumber(
    metadata.filesize_approx,
    { integer: true }
  );
  const availability = boundedSourceIdentity(metadata.availability, 100);
  const audioFormats = Array.isArray(metadata.formats)
    ? metadata.formats
    : Array.isArray(metadata.requested_formats)
      ? metadata.requested_formats
      : [];
  const seenAudioTracks = new Set<string>();
  const audioTracks: Array<Record<string, unknown>> = [];
  for (const format of audioFormats) {
    const codec = boundedSourceIdentity(format?.acodec, 80);
    if (!codec || codec === 'none') continue;
    const track = {
      codec,
      language: boundedSourceIdentity(format?.language, 64),
      format_id: boundedSourceIdentity(format?.format_id, 128),
      channels: finitePositiveMetadataNumber(format?.audio_channels, {
        maximum: 1024,
        integer: true,
      }),
    };
    const key = JSON.stringify(track);
    if (seenAudioTracks.has(key)) continue;
    seenAudioTracks.add(key);
    audioTracks.push(track);
    if (audioTracks.length >= 100) break;
  }
  const captionTracks = [
    ...Object.keys(metadata.subtitles || {}).map(language => ({
      language,
      kind: 'creator',
    })),
    ...Object.keys(metadata.automatic_captions || {}).map(language => ({
      language,
      kind: 'automatic',
    })),
  ]
    .filter(
      track =>
        typeof track.language === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(track.language)
    )
    .slice(0, 500);
  return {
    source: {
      canonical_url:
        safeHttpMetadataUrl(metadata.webpage_url) ||
        safeHttpMetadataUrl(metadata.original_url) ||
        parsed.toString(),
      extractor:
        boundedSourceIdentity(metadata.extractor_key, 256) ||
        boundedSourceIdentity(metadata.extractor, 256),
      media_id: boundedSourceIdentity(metadata.id, 1024),
    },
    metadata: {
      title: boundedMetadataText(metadata.title, 1000),
      channel:
        boundedMetadataText(metadata.channel, 500) ||
        boundedMetadataText(metadata.uploader, 500),
      channel_id:
        boundedSourceIdentity(metadata.channel_id, 512) ||
        boundedSourceIdentity(metadata.uploader_id, 512),
      channel_is_verified:
        typeof metadata.channel_is_verified === 'boolean'
          ? metadata.channel_is_verified
          : null,
      duration_seconds: finitePositiveMetadataNumber(metadata.duration),
      width: finitePositiveMetadataNumber(metadata.width, {
        maximum: 100_000,
        integer: true,
      }),
      height: finitePositiveMetadataNumber(metadata.height, {
        maximum: 100_000,
        integer: true,
      }),
      frame_rate: finitePositiveMetadataNumber(metadata.fps, {
        maximum: 10_000,
      }),
      upload_date: boundedSourceIdentity(metadata.upload_date, 32),
      thumbnail: safeHttpMetadataUrl(metadata.thumbnail),
      bytes: exactBytes || approximateBytes,
      bytes_estimated: exactBytes === null && approximateBytes !== null,
      audio_tracks: audioTracks,
      caption_tracks: captionTracks,
      availability,
      age_limit: Number.isFinite(Number(metadata.age_limit))
        ? Number(metadata.age_limit)
        : null,
      authentication_required: [
        'needs_auth',
        'private',
        'premium_only',
        'subscriber_only',
      ].includes(availability || '')
        ? true
        : availability !== null
          ? false
          : null,
      likely_original_source: null,
      original_source_assessment:
        'Not inferred from hosting platform or channel identity alone.',
    },
    compatibility: [],
  };
}

async function fetchUrlCaptions(input: {
  url?: string;
  kind?: 'creator' | 'automatic';
  language?: string;
}) {
  const parsed = new URL(String(input?.url || ''));
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https source URLs are supported.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Source URLs cannot contain embedded credentials.');
  }
  if (!['creator', 'automatic'].includes(String(input?.kind || ''))) {
    throw new Error('Caption kind must be creator or automatic.');
  }
  const language = String(input?.language || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(language)) {
    throw new Error('A valid caption language identifier is required.');
  }

  const binary = await ensureYtDlpBinary({ skipUpdate: true });
  const temporaryDirectory = await fs.mkdtemp(
    path.join(app.getPath('temp'), 'translator-mcp-captions-')
  );
  const outputTemplate = path.join(temporaryDirectory, 'captions.%(ext)s');
  try {
    await execFileAsync(
      binary,
      [
        '--ignore-config',
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        input.kind === 'creator' ? '--write-subs' : '--write-auto-subs',
        `--sub-langs=${language}`,
        '--sub-format',
        'srt/best',
        '--convert-subs',
        'srt',
        '-o',
        outputTemplate,
        parsed.toString(),
      ],
      {
        windowsHide: true,
        maxBuffer: MAX_PROBE_BUFFER_BYTES,
        encoding: 'utf8',
      }
    );
    const names = await fs.readdir(temporaryDirectory);
    const captionName = names
      .filter(name => name.toLowerCase().endsWith('.srt'))
      .sort()[0];
    if (!captionName) {
      throw new Error(
        `The requested ${input.kind} caption track was not returned for language ${language}.`
      );
    }
    const captionPath = path.join(temporaryDirectory, captionName);
    const stat = await fs.lstat(captionPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > MAX_CAPTION_BYTES
    ) {
      throw new Error(
        'Caption track is empty, invalid, or exceeds the safe size limit.'
      );
    }
    const content = await readStableBoundedUtf8File(
      captionPath,
      MAX_CAPTION_BYTES
    );
    if (!content.trim()) throw new Error('Caption track is empty.');
    return {
      content,
      format: 'srt',
      kind: input.kind,
      language,
      bytes: Buffer.byteLength(content),
      source_url: parsed.toString(),
    };
  } finally {
    await fs
      .rm(temporaryDirectory, { recursive: true, force: true })
      .catch(() => undefined);
  }
}

export function getAgentRuntimeContext() {
  return {
    app: {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
    },
    stage5: {
      account: {
        kind: 'device',
        reference: maskedDeviceReference(),
        identity_present: true,
        authenticated: false,
        connection_verified: false,
      },
    },
    providers: authoritativeProviderContext(),
  };
}

export function createAgentV2Handlers({ ffmpeg }: AgentV2Services) {
  return {
    async probeSource(input: {
      source?: { path?: string; url?: string; mock?: boolean };
    }) {
      if (input?.source?.url) return probeUrl(input.source.url);
      if (input?.source?.mock === true) {
        const mockPath = await ensureMockMedia(ffmpeg);
        const probe = await detailedProbe(ffmpeg.ffprobePath, mockPath);
        return {
          source: {
            kind: 'mock',
            version: MOCK_MEDIA_VERSION,
            path: mockPath,
          },
          metadata: {
            title: 'Translator MCP no-credit sample',
            duration_seconds: probe.duration_seconds,
            width: probe.video?.width || null,
            height: probe.video?.height || null,
            display_width: probe.video?.width || null,
            display_height: probe.video?.height || null,
            frame_rate: probe.video?.frame_rate || null,
            bytes: probe.bytes,
            audio_tracks: probe.audio
              ? [
                  {
                    language: 'en',
                    codec: probe.audio.codec,
                    sample_rate: probe.audio.sample_rate,
                  },
                ]
              : [],
            caption_tracks: [],
            authentication_required: false,
          },
          compatibility: [],
        };
      }
      const requestedPath = String(input?.source?.path || '').trim();
      if (!requestedPath) throw new Error('A source path or URL is required.');
      const filePath = path.resolve(requestedPath);
      const [stat, metadata] = await Promise.all([
        fs.stat(filePath),
        ffmpeg.getVideoMetadata(filePath),
      ]);
      if (!stat.isFile()) throw new Error(`Source is not a file: ${filePath}`);
      return {
        metadata: {
          title: path.basename(filePath),
          duration_seconds: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          display_width: metadata.displayWidth,
          display_height: metadata.displayHeight,
          frame_rate: metadata.frameRate,
          rotation_degrees: metadata.rotation,
          bytes: stat.size,
          audio_tracks: [],
          caption_tracks: [],
          authentication_required: false,
        },
        compatibility: [],
      };
    },

    async fetchSourceCaptions(input: {
      url?: string;
      kind?: 'creator' | 'automatic';
      language?: string;
    }) {
      return fetchUrlCaptions(input);
    },

    async inspectOutputDirectory(input: {
      path?: string;
      fileNames?: string[];
    }) {
      const requestedDirectory = String(input?.path || '').trim();
      if (!requestedDirectory)
        throw new Error('An output directory is required.');
      const requestedResolvedDirectory = path.resolve(requestedDirectory);
      const authorizationProbe = path.join(
        requestedResolvedDirectory,
        `.translator-agent-authorize-${randomUUID()}.tmp`
      );
      const canonicalAuthorizationProbe = assertAgentOutputPathAuthorized(
        authorizationProbe,
        'Planned output directory'
      );
      const directory = path.dirname(canonicalAuthorizationProbe);
      const stat = await fs.stat(directory);
      if (!stat.isDirectory())
        throw new Error('Planned output path is not a directory.');
      await fs.access(directory, fsSync.constants.W_OK);
      const filesystem = await fs.statfs(directory);
      if (Array.isArray(input?.fileNames) && input.fileNames.length > 64) {
        throw new Error(
          'Planned output inspection supports at most 64 filenames.'
        );
      }
      const fileNames = Array.isArray(input?.fileNames) ? input.fileNames : [];
      const existing_files: string[] = [];
      const planned_files: string[] = [];
      for (const fileNameValue of fileNames) {
        const fileName = String(fileNameValue || '').trim();
        if (!fileName || path.basename(fileName) !== fileName) {
          throw new Error('Planned output filenames must be plain basenames.');
        }
        const plannedPath = assertAgentOutputPathAuthorized(
          path.join(directory, fileName),
          'Planned output file'
        );
        planned_files.push(plannedPath);
        if (await fs.lstat(plannedPath).catch(() => null)) {
          existing_files.push(plannedPath);
        }
      }
      return {
        path: directory,
        writable: true,
        available_bytes: Number(filesystem.bavail) * Number(filesystem.bsize),
        existing_files,
        planned_files,
      };
    },

    async doctor(input: { checkNetwork?: boolean }) {
      const checks: Array<Record<string, unknown>> = [];
      for (const [name, executable] of [
        ['ffmpeg', ffmpeg.ffmpegPath],
        ['ffprobe', ffmpeg.ffprobePath],
      ] as const) {
        try {
          await fs.access(executable, fsSync.constants.X_OK);
          checks.push({ name, status: 'passed', path: executable });
        } catch (error) {
          checks.push({
            name,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      try {
        const { stdout, stderr } = await execFileAsync(
          ffmpeg.ffmpegPath,
          ['-hide_banner', '-encoders'],
          {
            encoding: 'utf8',
            timeout: 10_000,
            maxBuffer: MAX_PROBE_BUFFER_BYTES,
          }
        );
        const encoders = `${stdout}\n${stderr}`;
        const requiredEncoders = ['libx264', 'aac'];
        const missingEncoders = requiredEncoders.filter(
          encoder => !new RegExp(`\\b${encoder}\\b`).test(encoders)
        );
        checks.push({
          name: 'output-codecs',
          status: missingEncoders.length === 0 ? 'passed' : 'failed',
          required_encoders: requiredEncoders,
          missing_encoders: missingEncoders,
        });
      } catch (error) {
        checks.push({
          name: 'output-codecs',
          status: 'failed',
          required_encoders: ['libx264', 'aac'],
          error: error instanceof Error ? error.message : String(error),
        });
      }
      try {
        const ytDlpPath = await ensureYtDlpBinary({ skipUpdate: true });
        checks.push({ name: 'yt-dlp', status: 'passed', path: ytDlpPath });
      } catch (error) {
        checks.push({
          name: 'yt-dlp',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      const directories = [];
      for (const directory of configuredAllowedDirectories()) {
        try {
          await fs.access(directory, fsSync.constants.W_OK);
          const stats = await fs.statfs(directory);
          const availableBytes = Number(stats.bavail) * Number(stats.bsize);
          directories.push({
            path: directory,
            writable: true,
            available_bytes: availableBytes,
          });
        } catch (error) {
          directories.push({
            path: directory,
            writable: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      checks.push({
        name: 'output-directories',
        status:
          directories.length > 0 && directories.every(item => item.writable)
            ? 'passed'
            : 'failed',
        directories,
      });
      if (input?.checkNetwork !== false) {
        try {
          const response = await fetch(`${STAGE5_API_URL}/health`, {
            signal: AbortSignal.timeout(10_000),
          });
          checks.push({
            name: 'stage5-api',
            status: response.ok ? 'passed' : 'failed',
            http_status: response.status,
          });
        } catch (error) {
          checks.push({
            name: 'stage5-api',
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { checks, allowed_directories: directories };
    },

    async inspectMedia(input: {
      path?: string;
      expectedPreset?: string;
      expectedReceiptKind?: 'temporary_master';
      xAccountTier?: 'standard' | 'premium';
      expectedOperationId?: string;
      representativeFrames?: {
        outputDirectory?: string;
        baseName?: string;
        overwrite?: boolean;
        positionsSeconds?: number[];
        operationId?: string;
        protectedPaths?: string[];
      };
    }) {
      const requestedPath = String(input?.path || '').trim();
      if (!requestedPath) throw new Error('A media path is required.');
      const filePath = path.resolve(requestedPath);
      const before = await fs.stat(filePath, { bigint: true });
      if (!before.isFile()) {
        throw new Error(`Media inspection target is not a file: ${filePath}`);
      }
      const probe = await detailedProbe(ffmpeg.ffprobePath, filePath);
      const findings = verifyPresetCompatibility(
        probe,
        input?.expectedPreset,
        input?.xAccountTier || 'standard'
      );
      const expectedOperationId = input?.expectedOperationId
        ? assertAgentOperationId(input.expectedOperationId)
        : null;
      const expectedReceiptKind =
        input?.expectedReceiptKind || input?.expectedPreset || null;
      const ownership =
        expectedOperationId && expectedReceiptKind
          ? await readAgentOutputReceipt({
              outputPath: filePath,
              operationId: expectedOperationId,
              kind: expectedReceiptKind,
            })
          : null;
      let representativeFrames: Record<string, unknown> | null = null;
      const mediaPassed =
        findings.every(item => item.severity !== 'error') &&
        (!expectedOperationId || Boolean(ownership));
      if (mediaPassed && input?.representativeFrames) {
        try {
          representativeFrames = await renderRepresentativeFrames(ffmpeg, {
            videoPath: filePath,
            ...input.representativeFrames,
            receiptKindPrefix: 'verified_output_frame',
          });
        } catch (error) {
          findings.push({
            severity: 'error',
            code: 'representative_frame_extraction_failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const after = await fs.stat(filePath, { bigint: true });
      if (!after.isFile() || !sameFileSnapshot(before, after)) {
        throw new Error(
          `Media changed while Translator inspected it: ${filePath}`
        );
      }
      return {
        ...probe,
        expected_preset: input?.expectedPreset || null,
        expected_receipt_kind: expectedReceiptKind,
        expected_operation_id: expectedOperationId,
        operation_receipt_valid: expectedOperationId
          ? Boolean(ownership)
          : null,
        operation_receipt: ownership,
        x_account_tier: input?.xAccountTier || 'standard',
        passed:
          findings.every(item => item.severity !== 'error') &&
          (!expectedOperationId || Boolean(ownership)) &&
          (!input?.representativeFrames || Boolean(representativeFrames)),
        findings,
        representative_frames: representativeFrames,
      };
    },

    async writeTextOutput(input: {
      path?: string;
      content?: string;
      overwrite?: boolean;
      protectedPaths?: string[];
    }) {
      const content = String(input?.content ?? '');
      const bytes = Buffer.byteLength(content);
      if (bytes > MAX_AGENT_TEXT_OUTPUT_BYTES) {
        throw new Error(
          `Agent text output exceeds ${MAX_AGENT_TEXT_OUTPUT_BYTES} bytes.`
        );
      }
      const requestedPath = String(input?.path || '').trim();
      const authorizedPath = assertAgentOutputPathAuthorized(
        requestedPath,
        'Agent text output'
      );
      const outputPathIdentity =
        normalizeAgentOutputPathIdentity(authorizedPath);
      await assertAgentOutputDoesNotReferenceProtectedInputs(
        authorizedPath,
        input?.protectedPaths
      );
      if (activeTextOutputPaths.has(outputPathIdentity)) {
        throw new Error(
          `Another Translator operation is already writing this text output: ${authorizedPath}`
        );
      }
      activeTextOutputPaths.add(outputPathIdentity);
      try {
        const parent = path.dirname(authorizedPath);
        const parentStat = await fs.stat(parent);
        if (!parentStat.isDirectory())
          throw new Error('Agent output parent is not a directory.');
        const existing = await fs.lstat(authorizedPath).catch(() => null);
        if (existing && input?.overwrite !== true) {
          if (!existing.isFile() || existing.isSymbolicLink()) {
            throw new Error(
              'Agent text output destination is not a regular file.'
            );
          }
          if (existing.size <= MAX_AGENT_TEXT_OUTPUT_BYTES) {
            const current = await readStableBoundedUtf8File(
              authorizedPath,
              MAX_AGENT_TEXT_OUTPUT_BYTES
            );
            if (current === content) {
              return {
                path: authorizedPath,
                bytes,
                overwritten: false,
                reused: true,
                sha256: createHash('sha256').update(content).digest('hex'),
              };
            }
          }
          throw new Error(
            `Agent text output already exists: ${authorizedPath}`
          );
        }
        const temporaryPath = path.join(
          parent,
          `.${path.basename(authorizedPath)}.${process.pid}.${randomUUID()}.tmp`
        );
        const authorizedTemporary = assertAgentOutputPathAuthorized(
          temporaryPath,
          'Agent text output temporary file'
        );
        try {
          await fs.writeFile(authorizedTemporary, content, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
          });
          const finalPath = assertAgentOutputPathAuthorized(
            requestedPath,
            'Agent text output'
          );
          if (finalPath !== authorizedPath) {
            throw new Error('Agent output destination changed while writing.');
          }
          await publishAgentOutputFile({
            temporaryPath: authorizedTemporary,
            outputPath: finalPath,
            overwrite: input?.overwrite === true,
          });
        } finally {
          await fs.unlink(authorizedTemporary).catch(() => undefined);
        }
        return {
          path: authorizedPath,
          bytes,
          overwritten: input?.overwrite === true,
          reused: false,
          sha256: createHash('sha256').update(content).digest('hex'),
        };
      } finally {
        activeTextOutputPaths.delete(outputPathIdentity);
      }
    },

    async transcodeOutput(
      input: {
        sourcePath?: string;
        outputPath?: string;
        preset?: string;
        operationId?: string;
        overwrite?: boolean;
        protectedPaths?: string[];
        sourceOperationId?: string;
        sourceFingerprint?: { sha256?: unknown; bytes?: unknown };
      },
      onProgress?: (progress: Record<string, unknown>) => void
    ) {
      const requestedSourcePath = path.resolve(String(input?.sourcePath || ''));
      const requestedOutput = String(input?.outputPath || '').trim();
      if (!String(input?.sourcePath || '').trim() || !requestedOutput) {
        throw new Error('Transcoding requires sourcePath and outputPath.');
      }
      const outputPath = assertAgentOutputPathAuthorized(
        requestedOutput,
        'Preset video output'
      );
      const outputPathIdentity = normalizeAgentOutputPathIdentity(outputPath);
      const sourcePath = await fs.realpath(requestedSourcePath);
      if (await pathsReferenceSameFile(sourcePath, outputPath))
        throw new Error('Preset output cannot overwrite its source.');
      await assertAgentOutputDoesNotReferenceProtectedInputs(
        outputPath,
        input?.protectedPaths
      );
      const sourceBefore = await fs.stat(sourcePath, { bigint: true });
      if (!sourceBefore.isFile())
        throw new Error(`Transcode source is not a file: ${sourcePath}`);
      const sourceOperationId = input?.sourceOperationId
        ? assertAgentOperationId(input.sourceOperationId)
        : null;
      const expectedSourceFingerprint = parseExpectedAgentFileFingerprint(
        input?.sourceFingerprint || null
      );
      if (
        sourceOperationId &&
        !isAgentTemporaryMasterPath(sourcePath, sourceOperationId)
      ) {
        throw new Error(
          'Transcode source does not belong to the claimed render operation.'
        );
      }
      if (
        isAgentTemporaryMasterPath(sourcePath) &&
        (!sourceOperationId || !expectedSourceFingerprint)
      ) {
        throw new Error(
          'A temporary render master requires its operation-bound fingerprint.'
        );
      }
      if (
        expectedSourceFingerprint &&
        BigInt(expectedSourceFingerprint.bytes) !== sourceBefore.size
      ) {
        throw new Error(
          `Transcode source no longer matches its claimed fingerprint: ${sourcePath}`
        );
      }
      const destinationParent = await fs.stat(path.dirname(outputPath));
      if (!destinationParent.isDirectory())
        throw new Error('Preset output parent is not a directory.');
      const preset = String(input?.preset || '') as AgentEncodingPreset;
      const definitions: Record<
        AgentEncodingPreset,
        {
          width?: number;
          height?: number;
          crf?: number;
          videoBitrate?: string;
          audioBitrate?: string;
        }
      > = {
        youtube_1080p: {
          width: 1920,
          height: 1080,
          crf: 18,
          audioBitrate: '192k',
        },
        youtube_4k: {
          width: 3840,
          height: 2160,
          crf: 18,
          audioBitrate: '256k',
        },
        x_long_video_720p: {
          width: 1280,
          height: 720,
          videoBitrate: '5M',
          audioBitrate: '128k',
        },
        x_long_video_1080p: {
          width: 1920,
          height: 1080,
          videoBitrate: '8M',
          audioBitrate: '192k',
        },
        archive_master: { crf: 15, audioBitrate: '320k' },
        preview_low_resolution: {
          width: 854,
          height: 480,
          crf: 28,
          audioBitrate: '96k',
        },
      };
      const definition = definitions[preset];
      if (!definition) throw new Error(`Unknown encoding preset: ${preset}`);
      const operationId = assertAgentOperationId(input?.operationId);
      const reusable = await readAgentOutputReceipt({
        outputPath,
        operationId,
        kind: preset,
      });
      if (reusable) {
        return {
          ...(await detailedProbe(ffmpeg.ffprobePath, outputPath)),
          preset,
          operation_id: operationId,
          operation_receipt: reusable,
          reused: true,
        };
      }
      if (activeTranscodeOutputPaths.has(outputPathIdentity)) {
        throw new Error(
          `Another Translator operation is already writing this preset output: ${outputPath}`
        );
      }
      const metadata = await ffmpeg.getVideoMetadata(sourcePath);
      const filters =
        definition.width && definition.height
          ? [
              `scale=w='min(iw,${definition.width})':h='min(ih,${definition.height})':force_original_aspect_ratio=decrease:force_divisible_by=2`,
              'setsar=1',
            ]
          : ['setsar=1'];
      if (preset.startsWith('x_') && Number(metadata.frameRate) > 30) {
        filters.push('fps=30');
      }
      const temporaryPath = assertAgentOutputPathAuthorized(
        path.join(
          path.dirname(outputPath),
          `.${path.basename(outputPath)}.${process.pid}.${randomUUID()}.partial.mp4`
        ),
        'Preset video temporary output'
      );
      const args = [
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
        preset === 'preview_low_resolution' ? 'veryfast' : 'medium',
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
      if (activeTranscodeOutputPaths.has(outputPathIdentity)) {
        throw new Error(
          `Another Translator operation is already writing this preset output: ${outputPath}`
        );
      }
      activeTranscodeOutputPaths.add(outputPathIdentity);
      const startedAt = Date.now();
      try {
        if (!input?.overwrite) {
          const destination = await fs.lstat(outputPath).catch(() => null);
          if (destination) {
            throw new Error(`Preset output already exists: ${outputPath}`);
          }
        }
        await ffmpeg.run(args, {
          operationId,
          totalDuration: metadata.duration,
          progress: percent => {
            const elapsedSeconds = (Date.now() - startedAt) / 1000;
            const estimatedRemainingSeconds =
              percent > 0
                ? Math.max(0, elapsedSeconds * (100 / percent - 1))
                : null;
            const estimatedFramesProcessed =
              metadata.frameRate && metadata.duration
                ? Math.round(
                    metadata.frameRate * metadata.duration * (percent / 100)
                  )
                : null;
            let outputBytes = 0;
            try {
              outputBytes = fsSync.statSync(temporaryPath).size;
            } catch {
              // The first progress event can precede creation of the output.
            }
            onProgress?.({
              percent,
              elapsed_seconds: Math.round(elapsedSeconds),
              estimated_remaining_seconds:
                estimatedRemainingSeconds == null
                  ? null
                  : Math.round(estimatedRemainingSeconds),
              estimated_frames_processed: estimatedFramesProcessed,
              encoding_frames_per_second:
                estimatedFramesProcessed !== null && elapsedSeconds > 0
                  ? Number(
                      (estimatedFramesProcessed / elapsedSeconds).toFixed(2)
                    )
                  : null,
              encoding_speed_realtime:
                metadata.duration && elapsedSeconds > 0
                  ? Number(
                      (
                        (metadata.duration * (percent / 100)) /
                        elapsedSeconds
                      ).toFixed(2)
                    )
                  : null,
              output_bytes: outputBytes,
              estimated_final_bytes:
                outputBytes > 0 && percent > 0
                  ? Math.ceil(outputBytes * (100 / percent))
                  : null,
            });
          },
        });
        const sourceAfter = await fs.stat(sourcePath, { bigint: true });
        let sourceMetadataRevalidatedBySha256 = false;
        let sourceVerified = sourceAfter.isFile();
        if (sourceVerified) {
          try {
            const verification = await verifyAgentTranscodeSourceSnapshot({
              sourcePath,
              before: sourceBefore,
              after: sourceAfter,
              expectedFingerprint: expectedSourceFingerprint,
            });
            sourceVerified = verification.verified;
            sourceMetadataRevalidatedBySha256 =
              verification.verified && verification.metadataOnlyChange;
          } catch {
            sourceVerified = false;
          }
        }
        if (!sourceVerified) {
          throw new Error(
            `Transcode source changed while Translator was encoding it: ${sourcePath}`
          );
        }
        const finalPath = assertAgentOutputPathAuthorized(
          requestedOutput,
          'Preset video output'
        );
        if (finalPath !== outputPath) {
          throw new Error('Preset output destination changed while encoding.');
        }
        const fingerprint = await fingerprintAgentOutputFile(temporaryPath);
        const { sha256 } = fingerprint;
        await writeAgentOutputReceipt({
          outputPath,
          operationId,
          kind: preset,
          bytes: fingerprint.bytes,
          sha256,
          authorizePath: assertAgentOutputPathAuthorized,
        });
        await publishAgentOutputFile({
          temporaryPath,
          outputPath: finalPath,
          overwrite: input?.overwrite === true,
        });
        onProgress?.({
          percent: 100,
          output_bytes: (await fs.stat(finalPath)).size,
          estimated_remaining_seconds: 0,
        });
        return {
          ...(await detailedProbe(ffmpeg.ffprobePath, finalPath)),
          preset,
          operation_id: operationId,
          sha256,
          source_metadata_revalidated_by_sha256:
            sourceMetadataRevalidatedBySha256,
          operation_receipt: { ...fingerprint, path: finalPath },
          reused: false,
        };
      } finally {
        await fs.unlink(temporaryPath).catch(() => undefined);
        activeTranscodeOutputPaths.delete(outputPathIdentity);
      }
    },

    async renderPreviewFrames(input: RepresentativeFrameInput) {
      return renderRepresentativeFrames(ffmpeg, {
        ...input,
        requireSubtitles: true,
        receiptKindPrefix: 'preview_frame',
      });
    },
    async reserveTemporaryOutput(input: {
      path?: string;
      operationId?: string;
    }) {
      const requestedPath = String(input?.path || '').trim();
      const operationId = assertAgentOperationId(input?.operationId);
      const authorizedPath = assertAgentOutputPathAuthorized(
        requestedPath,
        'MCP temporary render output'
      );
      if (!isAgentTemporaryMasterPath(authorizedPath, operationId)) {
        throw new Error(
          'Temporary master path does not belong to this render operation.'
        );
      }
      if (await fs.lstat(authorizedPath).catch(() => null)) {
        throw new Error(
          'MCP temporary render target already exists and must be cleaned through its ownership receipt before it can be reserved.'
        );
      }
      const receiptPath = await writeAgentTemporaryOutputReservation({
        outputPath: authorizedPath,
        operationId,
        authorizePath: assertAgentOutputPathAuthorized,
      });
      return {
        path: authorizedPath,
        receipt_path: receiptPath,
        reserved: true,
      };
    },

    async claimTemporaryOutput(input: { path?: string; operationId?: string }) {
      const requestedPath = String(input?.path || '').trim();
      const operationId = assertAgentOperationId(input?.operationId);
      const authorizedPath = assertAgentOutputPathAuthorized(
        requestedPath,
        'MCP temporary render output'
      );
      if (!isAgentTemporaryMasterPath(authorizedPath, operationId)) {
        throw new Error(
          'Temporary master path does not belong to this render operation.'
        );
      }
      const stat = await fs.lstat(authorizedPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('MCP temporary render target is not a regular file.');
      }
      const reservation = await readAgentTemporaryOutputReservation({
        outputPath: authorizedPath,
        operationId,
      });
      if (!reservation) {
        throw new Error(
          'MCP temporary render target was not reserved by this operation and will not be claimed.'
        );
      }
      const fingerprint = await fingerprintAgentOutputFile(authorizedPath);
      const { sha256 } = fingerprint;
      const receiptPath = await writeAgentOutputReceipt({
        outputPath: authorizedPath,
        operationId,
        kind: 'temporary_master',
        bytes: fingerprint.bytes,
        sha256,
        authorizePath: assertAgentOutputPathAuthorized,
        allowedPriorKinds: ['temporary_master_reservation'],
      });
      return {
        path: authorizedPath,
        receipt_path: receiptPath,
        bytes: fingerprint.bytes,
        sha256,
      };
    },

    async deleteTemporaryOutput(input: {
      path?: string;
      operationId?: string;
    }) {
      const requestedPath = String(input?.path || '').trim();
      const operationId = assertAgentOperationId(input?.operationId);
      const authorizedPath = assertAgentOutputPathAuthorized(
        requestedPath,
        'MCP temporary render output'
      );
      if (!isAgentTemporaryMasterPath(authorizedPath, operationId)) {
        throw new Error(
          "Only this render operation's MCP temporary master can be removed."
        );
      }
      const stat = await fs.lstat(authorizedPath).catch(() => null);
      const receiptPath = getAgentOutputReceiptPath(
        authorizedPath,
        operationId
      );
      if (!stat) {
        const reservation = await readAgentTemporaryOutputReservation({
          outputPath: authorizedPath,
          operationId,
        });
        const completedReceipt = await readAgentTemporaryOutputReceiptMetadata({
          outputPath: authorizedPath,
          operationId,
        });
        if (reservation || completedReceipt) {
          await fs.unlink(receiptPath);
          return {
            path: authorizedPath,
            removed: false,
            reason: 'not_found',
            receipt_removed: true,
          };
        }
        return {
          path: authorizedPath,
          removed: false,
          reason: 'not_found',
          receipt_removed: false,
        };
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('MCP temporary render target is not a regular file.');
      }
      const completedOwnership = await readAgentOutputReceipt({
        outputPath: authorizedPath,
        operationId,
        kind: 'temporary_master',
      });
      const reservation = completedOwnership
        ? null
        : await readAgentTemporaryOutputReservation({
            outputPath: authorizedPath,
            operationId,
          });
      if (!completedOwnership && !reservation) {
        throw new Error(
          'MCP temporary render target has no valid ownership receipt and will not be removed.'
        );
      }
      await fs.unlink(authorizedPath);
      await fs.unlink(receiptPath).catch(error => {
        if (error?.code !== 'ENOENT') throw error;
      });
      return { path: authorizedPath, removed: true, receipt_removed: true };
    },
  };
}

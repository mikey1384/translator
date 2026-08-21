import fsp from 'node:fs/promises';
import path from 'node:path';

import { parseSrt } from '../../../shared/helpers/index.js';
import { CancelledError } from '../../../shared/cancelled-error.js';

type YtDlpInfo = Record<string, unknown> & {
  automatic_captions?: Record<string, unknown>;
  language?: unknown;
  original_language?: unknown;
};

export type AutomaticCaptionRecoveryResult = {
  subtitles: string;
  languageCode: string;
  info: YtDlpInfo;
};

export type AutomaticCaptionCommandRunner = (
  args: string[],
  context: string
) => Promise<{ stdout?: string | Buffer | null }>;

type RecoveryOptions = {
  url: string;
  outputDir: string;
  filePrefix: string;
  ffmpegPath: string;
  connectionArgs?: string[];
  runYtDlp: AutomaticCaptionCommandRunner;
  onLog?: (message: string) => void;
};

const PUBLIC_LOOKUP_OPTIONS_WITH_VALUES = new Set([
  '--js-runtimes',
  '--retries',
  '--retry-sleep',
  '--sleep-requests',
  '--socket-timeout',
]);

const PUBLIC_LOOKUP_BOOLEAN_OPTIONS = new Set(['--force-ipv4', '--force-ipv6']);

/**
 * Keep only the small set of connection-tuning arguments created by this app.
 * An allowlist makes newly added yt-dlp credential, proxy, config, extractor,
 * header, impersonation, geo, or TLS options fail closed automatically.
 */
export function stripPrivateAccessArgs(args: string[]): string[] {
  const publicArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const separatorIndex = arg.indexOf('=');
    const optionName = separatorIndex >= 0 ? arg.slice(0, separatorIndex) : arg;
    if (PUBLIC_LOOKUP_BOOLEAN_OPTIONS.has(optionName)) {
      if (separatorIndex < 0) publicArgs.push(optionName);
      continue;
    }
    if (PUBLIC_LOOKUP_OPTIONS_WITH_VALUES.has(optionName)) {
      if (separatorIndex >= 0) {
        if (arg.slice(separatorIndex + 1).trim()) publicArgs.push(arg);
        continue;
      }
      const value = args[index + 1];
      if (value && !value.startsWith('-')) {
        publicArgs.push(optionName, value);
        index += 1;
      }
      continue;
    }
  }
  return publicArgs;
}

function normalizedLanguage(value: unknown): string | null {
  const language = String(value || '')
    .trim()
    .toLowerCase();
  return language || null;
}

function hasCaptionFormats(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      item =>
        item &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).url === 'string'
    )
  );
}

/**
 * Selects only a track that can be tied to the video's original language.
 * It intentionally refuses an arbitrary translated automatic-caption track.
 */
export function selectOriginalAutomaticCaptionLanguage(
  info: YtDlpInfo
): string | null {
  const automaticCaptions = info.automatic_captions;
  if (!automaticCaptions || typeof automaticCaptions !== 'object') {
    return null;
  }

  const available = Object.entries(automaticCaptions)
    .filter(([key, value]) => key !== 'live_chat' && hasCaptionFormats(value))
    .map(([key]) => key)
    .sort();
  if (available.length === 0) return null;

  const availableByNormalizedKey = new Map(
    available.map(key => [key.toLowerCase(), key])
  );
  const originalLanguages = [
    normalizedLanguage(info.original_language),
    normalizedLanguage(info.language),
  ].filter((value): value is string => Boolean(value));

  for (const language of originalLanguages) {
    for (const candidate of [`${language}-orig`, language]) {
      const selected = availableByNormalizedKey.get(candidate);
      if (selected) return selected;
    }
  }

  const explicitOriginalTracks = available.filter(key => /-orig$/i.test(key));
  if (explicitOriginalTracks.length === 1) {
    return explicitOriginalTracks[0];
  }

  // A single advertised automatic-caption language is unambiguous even when
  // yt-dlp omits the video's language field.
  return available.length === 1 ? available[0] : null;
}

function parseInfo(
  stdout: string | Buffer | null | undefined
): YtDlpInfo | null {
  const text = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : stdout;
  if (!text?.trim()) return null;
  try {
    const parsed = JSON.parse(text.trim());
    return parsed && typeof parsed === 'object' ? (parsed as YtDlpInfo) : null;
  } catch {
    return null;
  }
}

async function removeRecoverySidecars(
  outputDir: string,
  filePrefix: string
): Promise<void> {
  const entries = await fsp.readdir(outputDir).catch(() => []);
  await Promise.all(
    entries
      .filter(entry => entry.startsWith(filePrefix))
      .map(entry =>
        fsp.unlink(path.join(outputDir, entry)).catch(() => undefined)
      )
  );
}

/**
 * Performs a new public, unauthenticated lookup after a proven media-transfer
 * 403. It never carries cookies or other credentials from the failed media
 * request, and it downloads subtitle data only.
 */
export async function recoverPublicYouTubeAutomaticCaptions({
  url,
  outputDir,
  filePrefix,
  ffmpegPath,
  connectionArgs = [],
  runYtDlp,
  onLog,
}: RecoveryOptions): Promise<AutomaticCaptionRecoveryResult | null> {
  const outputTemplate = path.join(outputDir, `${filePrefix}%(id)s.%(ext)s`);
  const publicConnectionArgs = stripPrivateAccessArgs(connectionArgs);

  try {
    const infoResult = await runYtDlp(
      [
        '--ignore-config',
        '--no-playlist',
        '--skip-download',
        '--dump-single-json',
        '--no-warnings',
        ...publicConnectionArgs,
        url,
      ],
      'checking public automatic captions'
    );
    const info = parseInfo(infoResult.stdout);
    if (!info) {
      onLog?.('Public caption lookup did not return valid metadata.');
      return null;
    }

    const languageCode = selectOriginalAutomaticCaptionLanguage(info);
    if (!languageCode) {
      onLog?.('No unambiguous original automatic-caption track is public.');
      return null;
    }

    await runYtDlp(
      [
        '--ignore-config',
        '--no-playlist',
        '--skip-download',
        '--write-auto-subs',
        '--sub-langs',
        languageCode,
        '--sub-format',
        'vtt',
        '--convert-subs',
        'srt',
        '--output',
        outputTemplate,
        '--ffmpeg-location',
        ffmpegPath,
        '--no-warnings',
        ...publicConnectionArgs,
        url,
      ],
      'downloading public automatic captions'
    );

    const entries = await fsp.readdir(outputDir);
    const candidates = entries
      .filter(
        entry =>
          entry.startsWith(filePrefix) && entry.toLowerCase().endsWith('.srt')
      )
      .sort();
    for (const candidate of candidates) {
      const subtitles = await fsp.readFile(
        path.join(outputDir, candidate),
        'utf8'
      );
      if (parseSrt(subtitles).length > 0) {
        return { subtitles, languageCode, info };
      }
    }

    onLog?.('Automatic-caption download returned no valid SRT cues.');
    return null;
  } catch (error) {
    if (error instanceof CancelledError) throw error;
    onLog?.('Public automatic-caption recovery was unavailable.');
    return null;
  } finally {
    await removeRecoverySidecars(outputDir, filePrefix);
  }
}

// Refuses sources a single-video download should never fetch: channels and
// playlists (every entry would download), live broadcasts (they record until
// the stream ends) and, unless the user confirmed, very long videos. Checks
// ride on yt-dlp's own extraction through --print, so they cost no extra
// network request.

export type UrlSourceRejectionCode =
  | 'collection_url'
  | 'live_stream'
  | 'long_video';

/** Videos at least this long ask for confirmation before downloading. */
export const LONG_VIDEO_CONFIRM_SECONDS = 60 * 60;

const REJECTION_MESSAGES: Record<UrlSourceRejectionCode, string> = {
  collection_url:
    'This is a channel or playlist link. Paste a link to a single video.',
  live_stream: 'This is a live stream. It can be downloaded after it ends.',
  long_video: 'This video is long. Confirm to download it.',
};

export class UrlSourceRejectedError extends Error {
  readonly code: UrlSourceRejectionCode;
  readonly durationSec?: number;
  readonly estimatedBytes?: number;

  constructor(
    code: UrlSourceRejectionCode,
    details: { durationSec?: number; estimatedBytes?: number } = {}
  ) {
    super(REJECTION_MESSAGES[code]);
    this.name = 'UrlSourceRejectedError';
    this.code = code;
    this.durationSec = details.durationSec;
    this.estimatedBytes = details.estimatedBytes;
  }
}

/**
 * yt-dlp flags that keep a download to one video. --no-playlist only matters
 * for links naming a video and a playlist; --playlist-items 1 is the hard
 * stop for any link that still turns out to be a playlist.
 */
export const SINGLE_VIDEO_ARGS: readonly string[] = [
  '--no-playlist',
  '--playlist-items',
  '1',
];

const GUARD_PREFIX = '__stage5_guard__';

/**
 * `pre_process` runs once per video right after extraction, before format
 * selection; `before_dl` runs after format selection, before any media
 * bytes are fetched, so the chosen format's size is known there.
 */
export function buildSourceGuardPrintArgs(): string[] {
  return [
    '--print',
    `pre_process:${GUARD_PREFIX}playlist_id\t%(playlist_id)s`,
    '--print',
    `pre_process:${GUARD_PREFIX}live_status\t%(live_status)s`,
    '--print',
    `pre_process:${GUARD_PREFIX}duration\t%(duration)s`,
    '--print',
    `before_dl:${GUARD_PREFIX}filesize\t%(filesize,filesize_approx)s`,
  ];
}

function printedValue(value: string): string | null {
  const text = value.trim();
  return text && text !== 'NA' && text !== 'None' && text !== 'null'
    ? text
    : null;
}

function positiveNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export type SourceGuard = {
  /** True when the line was a guard line (consumed, not progress output). */
  applyLine: (line: string) => boolean;
  /**
   * Called for every non-guard line. A long video whose size never printed
   * is still stopped once media bytes start flowing.
   */
  noteOutputLine: (line: string) => void;
  readonly rejection: UrlSourceRejectedError | null;
};

export function createSourceGuard(options: {
  isYouTube: boolean;
  allowLongVideo?: boolean;
  longVideoSeconds?: number;
}): SourceGuard {
  const longVideoSeconds =
    options.longVideoSeconds ?? LONG_VIDEO_CONFIRM_SECONDS;
  let rejection: UrlSourceRejectedError | null = null;
  let pendingLongDurationSec: number | null = null;

  const reject = (error: UrlSourceRejectedError) => {
    if (!rejection) rejection = error;
  };

  return {
    applyLine(line) {
      if (!line.startsWith(GUARD_PREFIX)) return false;
      const payload = line.slice(GUARD_PREFIX.length);
      const tab = payload.indexOf('\t');
      if (tab <= 0) return true;
      const key = payload.slice(0, tab);
      const value = printedValue(payload.slice(tab + 1));

      switch (key) {
        case 'playlist_id':
          // Only YouTube: elsewhere a single post with several videos (an X
          // thread, an Instagram carousel) is also a "playlist", and
          // --playlist-items 1 keeps that to its first video.
          if (options.isYouTube && value) {
            reject(new UrlSourceRejectedError('collection_url'));
          }
          break;
        case 'live_status':
          if (
            value === 'is_live' ||
            value === 'is_upcoming' ||
            value === 'post_live'
          ) {
            reject(new UrlSourceRejectedError('live_stream'));
          }
          break;
        case 'duration': {
          const durationSec = positiveNumber(value);
          if (
            !options.allowLongVideo &&
            durationSec !== undefined &&
            durationSec >= longVideoSeconds
          ) {
            pendingLongDurationSec = durationSec;
          }
          break;
        }
        case 'filesize':
          if (pendingLongDurationSec !== null) {
            reject(
              new UrlSourceRejectedError('long_video', {
                durationSec: pendingLongDurationSec,
                estimatedBytes: positiveNumber(value),
              })
            );
          }
          break;
        default:
          break;
      }
      return true;
    },
    noteOutputLine(line) {
      if (pendingLongDurationSec === null || rejection) return;
      if (/^\[download\]\s+[\d.]+%/.test(line)) {
        reject(
          new UrlSourceRejectedError('long_video', {
            durationSec: pendingLongDurationSec,
          })
        );
      }
    },
    get rejection() {
      return rejection;
    },
  };
}

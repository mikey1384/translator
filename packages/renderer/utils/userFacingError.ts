import {
  ERROR_CODES,
  STAGE5_TRANSCRIPTION_MAX_AUDIO_HOURS,
  isUrlDownloadErrorCode,
  type UrlDownloadErrorCode,
} from '../../shared/constants';

/**
 * One reading of every failure the user can see. Main, the relay and the
 * server report failures as codes ("insufficient-credits"), HTTP statuses,
 * IPC-wrapped messages ("Error invoking remote method 'x': Error: …") or
 * English sentences. This turns any of them into a typed error with an i18n
 * key, so screens show the UI language and decide credits vs. retry vs.
 * report from `kind`, never from English text.
 *
 * Pure: no i18n instance, no stores. `taskFailure.ts` adds the side effects
 * (credits dialog, report prompt).
 */

/** What the user started. Credits and report copy are worded for it. */
export type ErrorTask =
  | 'transcription'
  | 'translation'
  | 'dubbing'
  | 'summary'
  | 'videoSearch'
  | 'download'
  | 'export'
  | 'other';

export type UserFacingErrorKind =
  | 'insufficient-credits'
  | 'cancelled'
  | 'update-required'
  | 'api-key'
  | 'source-missing'
  | 'disk-space'
  | 'download'
  | 'network'
  | 'busy'
  | 'server'
  | 'unexpected';

/**
 * auto: open the report dialog (genuinely unexpected).
 * offer: show a Report link next to the message, don't interrupt.
 * none: the message itself tells the user what to do.
 */
export type ReportPolicy = 'auto' | 'offer' | 'none';

export type UserFacingError = {
  kind: UserFacingErrorKind;
  task: ErrorTask;
  /** Machine code when one was recognized (ERROR_CODES value or download code). */
  code: string | null;
  i18nKey: string;
  defaultText: string;
  params?: Record<string, unknown>;
  retryable: boolean;
  report: ReportPolicy;
  /** Original text with IPC wrappers removed; for logs and reports only. */
  detail: string;
};

export type ErrorInput =
  | string
  | null
  | undefined
  | Error
  | {
      message?: unknown;
      error?: unknown;
      errorCode?: unknown;
      status?: unknown;
      response?: { status?: unknown; data?: unknown };
      blockedReason?: unknown;
      cancelled?: unknown;
      name?: unknown;
    };

const IPC_PREFIX_RE = /^Error invoking remote method '[^']*':\s*/i;
const ERROR_PREFIX_RE = /^(?:Error:\s*)+/i;

/** Remove Electron's "Error invoking remote method '…': Error: " wrapper. */
export function stripIpcErrorPrefix(text: unknown): string {
  return String(text ?? '')
    .trim()
    .replace(IPC_PREFIX_RE, '')
    .replace(ERROR_PREFIX_RE, '')
    .trim();
}

function textOf(input: ErrorInput): string {
  if (input == null) return '';
  if (typeof input === 'string') return stripIpcErrorPrefix(input);
  const anyInput = input as any;
  const parts = [anyInput.error, anyInput.message]
    .filter(part => typeof part === 'string' && part.trim())
    .map(stripIpcErrorPrefix);
  return parts[0] ?? '';
}

function statusOf(input: ErrorInput): number | null {
  if (!input || typeof input !== 'object') return null;
  const anyInput = input as any;
  const status = anyInput.response?.status ?? anyInput.status;
  return typeof status === 'number' ? status : null;
}

/** True for every shape a credit refusal takes on its way to the UI. */
export function isInsufficientCreditsError(input: ErrorInput): boolean {
  if (statusOf(input) === 402) return true;
  if (
    input &&
    typeof input === 'object' &&
    (input as any).blockedReason === 'insufficient_credits'
  ) {
    return true;
  }
  return textOf(input).includes(ERROR_CODES.INSUFFICIENT_CREDITS);
}

const CANCEL_TEXT_RE =
  /^(?:operation|process|download|request)?\s*cancell?ed\.?$|^aborterror\b|^the operation was aborted/i;

function isCancellation(input: ErrorInput, text: string): boolean {
  if (input && typeof input === 'object') {
    const anyInput = input as any;
    if (anyInput.cancelled === true) return true;
    if (anyInput.name === 'AbortError' || anyInput.name === 'CancelledError') {
      return true;
    }
  }
  return CANCEL_TEXT_RE.test(text);
}

// Codes with their own explanation. Shared with byoErrors.ts.
export const ERROR_CODE_TO_I18N_KEY: Record<string, string> = {
  [ERROR_CODES.OPENAI_KEY_INVALID]: 'errors.byo.openaiKeyInvalid',
  [ERROR_CODES.OPENAI_RATE_LIMIT]: 'errors.byo.openaiRateLimit',
  [ERROR_CODES.OPENAI_INSUFFICIENT_QUOTA]: 'errors.byo.openaiInsufficientQuota',
  [ERROR_CODES.ANTHROPIC_KEY_INVALID]: 'errors.byo.anthropicKeyInvalid',
  [ERROR_CODES.ANTHROPIC_RATE_LIMIT]: 'errors.byo.anthropicRateLimit',
  [ERROR_CODES.ANTHROPIC_INSUFFICIENT_QUOTA]:
    'errors.byo.anthropicInsufficientQuota',
  [ERROR_CODES.ELEVENLABS_KEY_INVALID]: 'errors.byo.elevenlabsKeyInvalid',
  [ERROR_CODES.ELEVENLABS_RATE_LIMIT]: 'errors.byo.elevenlabsRateLimit',
  [ERROR_CODES.ELEVENLABS_INSUFFICIENT_QUOTA]:
    'errors.byo.elevenlabsInsufficientQuota',
  // Transcription is ElevenLabs Scribe only; these replace the old Whisper
  // fallback with clear, final errors.
  [ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE]:
    'errors.transcription.providerUnavailable',
  [ERROR_CODES.TRANSCRIPTION_FILE_TOO_LARGE]:
    'errors.transcription.fileTooLarge',
  [ERROR_CODES.ELEVENLABS_KEY_REQUIRED]:
    'errors.transcription.elevenLabsKeyRequired',
};

export const ERROR_CODE_I18N_PARAMS: Record<string, Record<string, unknown>> = {
  [ERROR_CODES.TRANSCRIPTION_FILE_TOO_LARGE]: {
    hours: STAGE5_TRANSCRIPTION_MAX_AUDIO_HOURS,
    count: STAGE5_TRANSCRIPTION_MAX_AUDIO_HOURS,
  },
};

const RETRYABLE_CODES = new Set<string>([
  ERROR_CODES.OPENAI_RATE_LIMIT,
  ERROR_CODES.ANTHROPIC_RATE_LIMIT,
  ERROR_CODES.ELEVENLABS_RATE_LIMIT,
  ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE,
]);

export function findKnownErrorCode(text: string): string | null {
  if (!text) return null;
  for (const code of Object.keys(ERROR_CODE_TO_I18N_KEY)) {
    if (text.includes(code)) return code;
  }
  return null;
}

/** English copy of every download message main has sent (old and new). */
const DOWNLOAD_TEXT_CODES: Array<[RegExp, UrlDownloadErrorCode]> = [
  [/please enter a valid url|invalid url|url format/i, 'invalid_url'],
  [/website or url is not supported|unsupported url/i, 'unsupported_site'],
  [/restricted to certain audiences/i, 'audience_restricted'],
  [/not available in your country/i, 'region_locked'],
  [/this video is unavailable|video unavailable/i, 'unavailable'],
  [/this video is private/i, 'private'],
  [/video not found at this url|\(404 error\)/i, 'not_found'],
  [/requires signing in/i, 'login_required'],
  [/download was blocked \(http 403\)/i, 'media_blocked'],
  [/refused access to the video/i, 'access_refused'],
  [/failed to download video data/i, 'video_data_failed'],
  [/rate-limiting this network/i, 'rate_limited'],
  [/public automatic captions were found/i, 'captions_unreadable'],
  [/downloaded video could not be saved/i, 'save_failed'],
  [
    /yt-dlp|javascript runtime|output directory|downloader could not start|failed to write to output directory/i,
    'downloader_failed',
  ],
  [/video download failed|failed to process url/i, 'generic'],
];

const DOWNLOAD_DEFAULTS: Record<UrlDownloadErrorCode, string> = {
  invalid_url: 'That doesn’t look like a video link. Paste the full link.',
  unsupported_site: 'Translator can’t download videos from this website.',
  unavailable: 'This video is unavailable. It may have been removed.',
  private: 'This video is private.',
  not_found: 'No video was found at this link.',
  region_locked: 'This video isn’t available in your country.',
  audience_restricted:
    'This video is only shown to some viewers. If your account can watch it, connect to this site in Settings and try again.',
  login_required:
    'This video needs you to be signed in. Connect to this site in Settings and try again.',
  media_blocked:
    'The site blocked the video download, and no captions could be recovered.',
  access_refused: 'This site refused to give Translator the video.',
  video_data_failed:
    'The video couldn’t be downloaded. It may be region-locked or need a sign-in.',
  rate_limited:
    'YouTube is limiting downloads from your network right now. Wait a few minutes and try again.',
  network: 'Couldn’t connect. Check your internet connection and try again.',
  captions_unreadable:
    'YouTube captions were found, but Translator couldn’t read them.',
  save_failed: 'The video downloaded but couldn’t be saved. Try again.',
  downloader_failed:
    'The video downloader couldn’t start. Restart Translator and try again.',
  generic: 'The video couldn’t be downloaded. Try again or use another link.',
};

export function downloadErrorCodeFromText(
  text: string
): UrlDownloadErrorCode | null {
  if (!text) return null;
  const cleaned = text.replace(/^download error:\s*/i, '');
  for (const [re, code] of DOWNLOAD_TEXT_CODES) {
    if (re.test(cleaned)) return code;
  }
  return null;
}

const NETWORK_RE =
  /\b(?:network error|enotfound|eai_again|econnreset|econnrefused|econnaborted|etimedout|enetunreach|ehostunreach|err_network|err_internet_disconnected|fetch failed|socket hang up|getaddrinfo|internet connection)\b/i;
const BUSY_RE =
  /too-many-active-translations|translation-rate-limit|translation-queue-overloaded|\b429\b|too many requests|rate[- ]?limit/i;
const SERVER_RE =
  /status code 5\d\d|\bhttp(?: error)? 5\d\d\b|\b5\d\d (?:internal server error|bad gateway|service unavailable|gateway timeout)|internal server error|bad gateway|service unavailable|gateway timeout/i;
const DISK_RE = /\bENOSPC\b|no space left on device|disk quota exceeded/i;

const TASK_FAILED_DEFAULTS: Record<ErrorTask, string> = {
  transcription:
    'Transcription stopped because of an unexpected problem. Lines already transcribed are kept.',
  translation:
    'Translation stopped because of an unexpected problem. Lines already translated are kept.',
  dubbing: 'Dubbing stopped because of an unexpected problem.',
  summary: 'The summary stopped because of an unexpected problem.',
  videoSearch: 'The video search stopped because of an unexpected problem.',
  download: DOWNLOAD_DEFAULTS.generic,
  export: 'Making the video stopped because of an unexpected problem.',
  other: 'Something went wrong. Please try again.',
};

const CREDITS_DEFAULTS: Record<ErrorTask, string> = {
  transcription: 'Not enough credits to transcribe this.',
  translation: 'Not enough credits to translate this.',
  dubbing: 'Not enough credits to dub this.',
  summary: 'Not enough credits for the summary.',
  videoSearch: 'Not enough credits to search for videos.',
  download: 'Not enough credits.',
  export: 'Not enough credits.',
  other: 'Not enough credits.',
};

function build(
  task: ErrorTask,
  detail: string,
  fields: Omit<UserFacingError, 'task' | 'detail'>
): UserFacingError {
  return { ...fields, task, detail };
}

export function classifyError(
  input: ErrorInput,
  options: { task?: ErrorTask } = {}
): UserFacingError {
  const task = options.task ?? 'other';
  const text = textOf(input);

  if (isInsufficientCreditsError(input)) {
    return build(task, text, {
      kind: 'insufficient-credits',
      code: ERROR_CODES.INSUFFICIENT_CREDITS,
      i18nKey: `errors.credits.${task}`,
      defaultText: CREDITS_DEFAULTS[task],
      retryable: false,
      report: 'none',
    });
  }

  if (isCancellation(input, text)) {
    return build(task, text, {
      kind: 'cancelled',
      code: null,
      i18nKey: 'generateSubtitles.status.cancelled',
      defaultText: 'Cancelled',
      retryable: true,
      report: 'none',
    });
  }

  if (text.includes(ERROR_CODES.UPDATE_REQUIRED) || statusOf(input) === 426) {
    return build(task, text, {
      kind: 'update-required',
      code: ERROR_CODES.UPDATE_REQUIRED,
      i18nKey: 'common.updateRequiredBody',
      defaultText:
        'This version of Translator is no longer supported. Update the app to continue.',
      retryable: false,
      report: 'none',
    });
  }

  const knownCode = findKnownErrorCode(text);
  if (knownCode) {
    return build(task, text, {
      kind: 'api-key',
      code: knownCode,
      i18nKey: ERROR_CODE_TO_I18N_KEY[knownCode],
      defaultText: 'API request failed. Check your API key and account.',
      params: ERROR_CODE_I18N_PARAMS[knownCode],
      retryable: RETRYABLE_CODES.has(knownCode),
      report: 'none',
    });
  }

  if (text.includes(ERROR_CODES.SOURCE_VIDEO_UNAVAILABLE)) {
    return build(task, text, {
      kind: 'source-missing',
      code: ERROR_CODES.SOURCE_VIDEO_UNAVAILABLE,
      i18nKey: 'common.error.sourceVideoUnavailable',
      defaultText:
        'The original video was removed or is no longer accessible. Open it again and try again.',
      retryable: false,
      report: 'none',
    });
  }

  if (
    text.includes(ERROR_CODES.INSUFFICIENT_DISK_SPACE) ||
    DISK_RE.test(text)
  ) {
    return build(task, text, {
      kind: 'disk-space',
      code: ERROR_CODES.INSUFFICIENT_DISK_SPACE,
      i18nKey: 'errors.diskFull',
      defaultText: 'Your disk is full. Free up some space and try again.',
      retryable: true,
      report: 'none',
    });
  }

  const explicitDownloadCode =
    input &&
    typeof input === 'object' &&
    isUrlDownloadErrorCode((input as any).errorCode)
      ? ((input as any).errorCode as UrlDownloadErrorCode)
      : null;
  const isDownloadTask = task === 'download' || /^download error:/i.test(text);
  const downloadCode =
    explicitDownloadCode ??
    downloadErrorCodeFromText(text) ??
    (isDownloadTask && NETWORK_RE.test(text)
      ? 'network'
      : isDownloadTask && text
        ? 'generic'
        : null);
  if (downloadCode) {
    const unexplained =
      downloadCode === 'generic' || downloadCode === 'downloader_failed';
    return build('download', text, {
      kind: 'download',
      code: downloadCode,
      i18nKey: `errors.download.${downloadCode}`,
      defaultText: DOWNLOAD_DEFAULTS[downloadCode],
      retryable:
        downloadCode !== 'private' && downloadCode !== 'unsupported_site',
      report: unexplained ? 'auto' : 'none',
    });
  }

  if (NETWORK_RE.test(text)) {
    return build(task, text, {
      kind: 'network',
      code: null,
      i18nKey: 'errors.network',
      defaultText:
        'Couldn’t reach the server. Check your internet connection and try again.',
      retryable: true,
      report: 'none',
    });
  }

  if (BUSY_RE.test(text)) {
    return build(task, text, {
      kind: 'busy',
      code: null,
      i18nKey: 'errors.busy',
      defaultText:
        'The service is busy right now. Wait a minute and try again.',
      retryable: true,
      report: 'none',
    });
  }

  if (SERVER_RE.test(text) || (statusOf(input) ?? 0) >= 500) {
    return build(task, text, {
      kind: 'server',
      code: null,
      i18nKey: `errors.server.${task}`,
      defaultText:
        task === 'translation'
          ? 'Translation stopped because our server had a problem. Lines already translated are kept. Try again in a minute.'
          : 'Our server had a problem. Try again in a minute.',
      retryable: true,
      report: 'offer',
    });
  }

  return build(task, text, {
    kind: 'unexpected',
    code: null,
    i18nKey: `errors.failed.${task}`,
    defaultText: TASK_FAILED_DEFAULTS[task],
    retryable: true,
    report: 'auto',
  });
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function formatUserFacingError(
  error: UserFacingError,
  t: Translate
): string {
  return t(error.i18nKey, {
    defaultValue: error.defaultText,
    ...(error.params ?? {}),
  });
}

/**
 * For text that may already be localized (the global banner): recognized
 * codes and English main-process messages are translated; anything else is
 * shown as given, since callers pass `t()` output there.
 */
export function localizeErrorText(
  text: string | null | undefined,
  t: Translate,
  options: { task?: ErrorTask } = {}
): string {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('__i18n__:')) return t(raw.slice(9));
  const error = classifyError(raw, options);
  if (error.kind === 'unexpected') return stripIpcErrorPrefix(raw);
  return formatUserFacingError(error, t);
}

/** Which task an operation id belongs to, for refusals reported by progress. */
export function taskForOperationId(
  operationId: string | null | undefined
): ErrorTask {
  const id = String(operationId || '');
  // A dub's pre-translation is part of the dub the user asked for.
  if (/(^|-)translate-dub-|(^|-)dub-translate-/.test(id)) return 'dubbing';
  if (id.startsWith('transcribe-') || /-transcribe(-cue)?$/.test(id)) {
    return 'transcription';
  }
  if (id.startsWith('translate-') || /-translate(-cue)?$/.test(id)) {
    return 'translation';
  }
  if (id.startsWith('dub-') || /-dub$/.test(id)) return 'dubbing';
  if (
    id.startsWith('summary-') ||
    id.startsWith('highlight-') ||
    id.startsWith('combined-') ||
    /-summary$/.test(id)
  ) {
    return 'summary';
  }
  if (id.startsWith('video-suggest') || id.startsWith('agent-video-')) {
    return 'videoSearch';
  }
  if (id.startsWith('download-')) return 'download';
  if (id.startsWith('render-') || /-merge$/.test(id)) return 'export';
  return 'other';
}

/**
 * Localized text for a raw error from main or a provider: a recognized
 * reason (network, API key, credits…) in the UI language, otherwise the
 * caller's own localized fallback. The raw text belongs in logs.
 */
export function localizeErrorOr(
  raw: ErrorInput,
  t: Translate,
  fallback: { key: string; defaultText: string },
  options: { task?: ErrorTask } = {}
): string {
  const error = classifyError(raw, options);
  if (error.kind === 'unexpected') {
    return t(fallback.key, { defaultValue: fallback.defaultText });
  }
  return formatUserFacingError(error, t);
}

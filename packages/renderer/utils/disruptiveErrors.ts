import { ERROR_CODES } from '../../shared/constants';

const CANCEL_OR_ABORT_RE =
  /\b(cancel(?:led|ed|ation)?|abort(?:error|ed|ing)?)\b/i;
const FAILURE_STAGE_RE = /\b(error|failed|failure|fatal|exception)\b/i;
const DISRUPTIVE_TEXT_RE =
  /\b(error|failed|failure|fatal|exception|crash|panic|timeout|timed out)\b/i;
const EXPECTED_USER_STATE_RE =
  /\b(insufficient[-_\s]?credits?|not enough credits?|insufficient[-_\s]?quota|rate[-\s]?limit|too many requests|invalid api key|missing api key|api key (?:is )?(?:invalid|required|missing|expired)|unauthorized|forbidden|payment required|update required|unsupported app version|needcookies|captcha|human check|invalid url|url format|no srt file|no subtitles|network error|internet connection|connection reset|connection refused|connection failed|socket|timed out|timeout|insufficient disk space|disk space)\b/i;
const EXPECTED_DOWNLOAD_CONTENT_RE =
  /\b(this video is unavailable|video unavailable|this video is private|website or url is not supported|unsupported url|video not found|404 error|region-locked|not available in your country|not available in your region|require login|requires login|members-only|members only|age-restricted|confirm your age|removed by the uploader|removed by uploader|copyright|geo(?:-|\s)?blocked)\b/i;
const DISRUPTIVE_DOWNLOAD_INFRA_RE =
  /\b(yt-dlp|ffmpeg|binary|executable|install(?:ing|ation)?|setup|writable copy|concurrent access|another translator instance|could not start yt-dlp process|could not access yt-dlp output stream|failed to parse final json output from yt-dlp|did not provide a final filename|downloaded file (?:not found|is empty)|output directory check failed|permission denied|enoent|eacces|eperm)\b/i;
const RESOURCE_TAGS = new Set([
  'img',
  'image',
  'script',
  'link',
  'audio',
  'video',
  'source',
  'track',
  'iframe',
]);

const BENIGN_VALIDATION_RE: RegExp[] = [
  /\bplease enter a valid url\b/i,
  /\binvalid url\b/i,
  /\burl format appears invalid\b/i,
];

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim();
}

function combineText(...values: Array<string | null | undefined>): string {
  return values.map(normalizeText).filter(Boolean).join(' ');
}

export function isExpectedUserFacingFailure(
  error: string | null | undefined
): boolean {
  const text = normalizeText(error);
  if (!text) return false;
  const containsExpectedCode =
    text.includes(ERROR_CODES.INSUFFICIENT_CREDITS) ||
    text.includes(ERROR_CODES.UPDATE_REQUIRED) ||
    text.includes(ERROR_CODES.OPENAI_KEY_INVALID) ||
    text.includes(ERROR_CODES.OPENAI_RATE_LIMIT) ||
    text.includes(ERROR_CODES.OPENAI_INSUFFICIENT_QUOTA) ||
    text.includes(ERROR_CODES.ANTHROPIC_KEY_INVALID) ||
    text.includes(ERROR_CODES.ANTHROPIC_RATE_LIMIT) ||
    text.includes(ERROR_CODES.ANTHROPIC_INSUFFICIENT_QUOTA) ||
    text.includes(ERROR_CODES.ELEVENLABS_KEY_INVALID) ||
    text.includes(ERROR_CODES.ELEVENLABS_RATE_LIMIT) ||
    text.includes(ERROR_CODES.ELEVENLABS_INSUFFICIENT_QUOTA);
  if (containsExpectedCode) return true;
  if (BENIGN_VALIDATION_RE.some(re => re.test(text))) return true;
  if (EXPECTED_USER_STATE_RE.test(text)) return true;
  return false;
}

function isExpectedDownloadContentFailure(text: string): boolean {
  if (!text) return false;
  return EXPECTED_DOWNLOAD_CONTENT_RE.test(text);
}

export function isDisruptiveStage(stage: string | null | undefined): boolean {
  const text = normalizeText(stage);
  if (!text) return false;
  if (CANCEL_OR_ABORT_RE.test(text)) return false;
  return FAILURE_STAGE_RE.test(text);
}

export function isDisruptiveGlobalError(
  error: string | null | undefined,
  kind?: 'validation' | 'operation' | 'unknown' | null
): boolean {
  const text = normalizeText(error);
  if (!text) return false;
  if (kind === 'validation') return false;
  if (CANCEL_OR_ABORT_RE.test(text)) return false;
  if (isExpectedUserFacingFailure(text)) return false;
  return DISRUPTIVE_TEXT_RE.test(text);
}

export function isDisruptiveTaskFailure({
  stage,
  error,
}: {
  stage: string | null | undefined;
  error?: string | null | undefined;
}): boolean {
  const normalizedStage = normalizeText(stage);
  const combined = combineText(stage, error);
  if (!normalizedStage) return false;
  if (CANCEL_OR_ABORT_RE.test(combined)) return false;
  if (isExpectedUserFacingFailure(combined)) return false;
  return FAILURE_STAGE_RE.test(normalizedStage);
}

export function isDisruptiveDownloadFailure({
  stage,
  error,
  kind,
}: {
  stage: string | null | undefined;
  error: string | null | undefined;
  kind?: 'validation' | 'operation' | 'unknown' | null;
}): boolean {
  const normalizedError = normalizeText(error);
  if (!isDisruptiveStage(stage)) return false;
  if (!normalizedError) {
    // If stage is a failure marker but no explicit error text is available,
    // keep reporting enabled for true stage-only failures.
    return kind !== 'validation';
  }
  if (isDisruptiveGlobalError(normalizedError, kind)) {
    return true;
  }
  if (kind === 'validation') {
    return false;
  }
  if (CANCEL_OR_ABORT_RE.test(normalizedError)) {
    return false;
  }
  if (isExpectedUserFacingFailure(normalizedError)) {
    return false;
  }
  if (isExpectedDownloadContentFailure(normalizedError)) {
    return false;
  }
  return DISRUPTIVE_DOWNLOAD_INFRA_RE.test(normalizedError);
}

export function isAbortLikeReason(reason: unknown): boolean {
  if (!reason) return false;
  const asAny = reason as any;
  const name = normalizeText(asAny?.name);
  const message =
    typeof reason === 'string'
      ? reason
      : normalizeText(asAny?.message || String(reason));
  return CANCEL_OR_ABORT_RE.test(name) || CANCEL_OR_ABORT_RE.test(message);
}

export function shouldIgnoreGlobalBrowserError(event: Event): boolean {
  if (!(event instanceof ErrorEvent)) {
    // Resource load errors (img/script/link/etc) are emitted as generic Event.
    return true;
  }

  const message = normalizeText(event.message).toLowerCase();
  if (message.includes('resizeobserver')) return true;

  const hasRuntimeDetails = Boolean(message || event.error || event.filename);
  if (!hasRuntimeDetails) return true;

  const target = event.target as any;
  const isWindowTarget = typeof window !== 'undefined' && target === window;
  const isDocumentTarget =
    typeof document !== 'undefined' && target === document;
  const tagName = normalizeText(target?.tagName).toLowerCase();

  if (!isWindowTarget && !isDocumentTarget && RESOURCE_TAGS.has(tagName)) {
    return true;
  }

  return false;
}

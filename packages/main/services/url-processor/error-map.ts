import log from 'electron-log';
import type { UrlDownloadErrorCode } from '../../../shared/constants/index.js';
import {
  REGION_LOCKED_RE,
  VIDEO_UNAVAILABLE_RE,
  classifyUrlDownloadFailureDetail,
  isAudienceRestrictedError,
  stripYtDlpDiagnosticEcho,
} from './failure-taxonomy.js';

export type UrlDownloadUserError = {
  // Stable reason; the renderer shows `errors.download.<code>`.
  code: UrlDownloadErrorCode;
  // English sentence for logs, agents and older callers. Never shown as-is
  // in the app UI.
  message: string;
};

const MESSAGES: Record<UrlDownloadErrorCode, string> = {
  invalid_url: 'The URL format appears invalid.',
  unsupported_site: 'This website or URL is not supported.',
  unavailable: 'This video is unavailable.',
  private: 'This video is private.',
  not_found: 'Video not found at this URL (404 Error).',
  region_locked: 'This video is not available in your country.',
  audience_restricted:
    'This video is restricted to certain audiences. If your account can view it, connect to this site in Settings and try again.',
  login_required:
    'This video requires signing in. Connect to this site in Settings and try again.',
  media_blocked:
    'Video download was blocked (HTTP 403), and no public automatic captions could be recovered.',
  access_refused: 'This site refused access to the video (HTTP 403).',
  video_data_failed:
    'Failed to download video data. The video might be region-locked or require login.',
  rate_limited:
    'YouTube is rate-limiting this network (HTTP 429) or blocking automated requests. Please wait and try again.',
  network: 'Network error. Please check your internet connection.',
  captions_unreadable:
    'Public automatic captions were found, but Translator could not read them.',
  save_failed: 'Downloaded video could not be saved.',
  downloader_failed:
    'The video downloader could not start. Restart Translator and try again.',
  generic: 'Video download failed. Please try again or use a different URL.',
};

export function urlDownloadErrorMessage(code: UrlDownloadErrorCode): string {
  return MESSAGES[code] ?? MESSAGES.generic;
}

export function mapDownloadError({
  rawErrorMessage,
  stderrContent = '',
}: {
  rawErrorMessage: string;
  stderrContent?: string;
}): UrlDownloadUserError {
  const combinedErrorText = stripYtDlpDiagnosticEcho(
    `${rawErrorMessage}\n${stderrContent}`
  ).toLowerCase();
  const failureDetail = classifyUrlDownloadFailureDetail({
    message: rawErrorMessage,
    stderr: stderrContent,
  });
  const pick = (code: UrlDownloadErrorCode): UrlDownloadUserError => ({
    code,
    message: MESSAGES[code],
  });

  if (
    isAudienceRestrictedError({
      message: rawErrorMessage,
      stderr: stderrContent,
    })
  ) {
    return pick('audience_restricted');
  }
  if (combinedErrorText.includes('unsupported url')) {
    return pick('unsupported_site');
  }
  if (REGION_LOCKED_RE.test(combinedErrorText)) {
    return pick('region_locked');
  }
  if (VIDEO_UNAVAILABLE_RE.test(combinedErrorText)) {
    return pick('unavailable');
  }
  if (
    combinedErrorText.includes('this video is private') ||
    combinedErrorText.includes('private video')
  ) {
    return pick('private');
  }
  if (combinedErrorText.includes('http error 404')) {
    return pick('not_found');
  }
  if (failureDetail.code === 'http_403_media') {
    return pick('media_blocked');
  }
  if (
    failureDetail.code === 'http_403_source' ||
    failureDetail.code === 'http_403_unknown'
  ) {
    return pick('access_refused');
  }
  if (combinedErrorText.includes('invalid url')) {
    return pick('invalid_url');
  }
  if (
    combinedErrorText.includes('failed to resolve') ||
    combinedErrorText.includes('name or service not known') ||
    combinedErrorText.includes('temporary failure in name resolution') ||
    combinedErrorText.includes('nodename nor servname provided') ||
    combinedErrorText.includes('could not resolve host') ||
    combinedErrorText.includes('getaddrinfo') ||
    combinedErrorText.includes('network is unreachable')
  ) {
    return pick('network');
  }
  if (combinedErrorText.includes('unable to download video data')) {
    return pick('video_data_failed');
  }
  if (
    /http error 429|too\s+many\s+requests|looks suspicious|verify you are human/.test(
      combinedErrorText
    )
  ) {
    return pick('rate_limited');
  }
  if (failureDetail.code === 'login_required') {
    return pick('login_required');
  }
  if (failureDetail.code === 'network') {
    return pick('network');
  }

  log.info(
    `[URLprocessor] No specific error mapping (code=${failureDetail.code}, phase=${failureDetail.phase}, httpStatus=${failureDetail.httpStatus ?? 'none'}, rawBytes=${Buffer.byteLength(rawErrorMessage, 'utf8')}, stderrBytes=${Buffer.byteLength(stderrContent, 'utf8')}; content omitted).`
  );
  return pick('generic');
}

export function mapErrorToUserFriendly(options: {
  rawErrorMessage: string;
  stderrContent?: string;
}): string {
  return mapDownloadError(options).message;
}

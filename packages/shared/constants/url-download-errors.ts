/**
 * Stable reasons a link download can fail. Main sends one of these next to its
 * English log message; the renderer shows `errors.download.<code>` in the UI
 * language. Keep values snake_case: they double as i18n key suffixes.
 */
export const URL_DOWNLOAD_ERROR_CODES = [
  'invalid_url',
  'unsupported_site',
  'unavailable',
  'private',
  'not_found',
  'region_locked',
  'audience_restricted',
  'login_required',
  'media_blocked',
  'access_refused',
  'video_data_failed',
  'rate_limited',
  'network',
  'captions_unreadable',
  'save_failed',
  'downloader_failed',
  'generic',
] as const;

export type UrlDownloadErrorCode = (typeof URL_DOWNLOAD_ERROR_CODES)[number];

export function isUrlDownloadErrorCode(
  value: unknown
): value is UrlDownloadErrorCode {
  return (
    typeof value === 'string' &&
    (URL_DOWNLOAD_ERROR_CODES as readonly string[]).includes(value)
  );
}

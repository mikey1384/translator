export type UrlSourceType = 'youtube' | 'other';

export type NeedCookiesCause =
  | 'rate_limited'
  | 'login_required'
  | 'human_verification'
  | 'other';

export type UrlDownloadFailureCategory =
  | 'validation'
  | 'runtime_setup'
  | 'network'
  | 'site_rejected'
  | 'storage'
  | 'postprocessing'
  | 'unknown';

export type UrlConnectionContext = 'download_recovery' | 'settings';

export type UrlDownloadFunnelEvent =
  | 'url_download_started'
  | 'url_download_completed'
  | 'url_download_caption_only'
  | 'url_download_cookie_required'
  | 'url_download_cancelled'
  | 'url_download_failed'
  | 'url_cookie_connect_started'
  | 'url_cookie_connect_completed'
  | 'url_cookie_connect_cancelled'
  | 'url_cookie_connect_failed';

export class NeedCookiesError extends Error {
  readonly causeCode: NeedCookiesCause;

  constructor(causeCode: NeedCookiesCause) {
    super('NeedCookies');
    this.name = 'NeedCookiesError';
    this.causeCode = causeCode;
  }
}

function hostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isYouTubeHostname(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === 'youtu.be' ||
    normalized === 'youtube.com' ||
    normalized.endsWith('.youtube.com')
  );
}

export function classifyUrlSourceType(rawUrl: string): UrlSourceType {
  return isYouTubeHostname(hostname(rawUrl)) ? 'youtube' : 'other';
}

export function classifyUrlDownloadFailure(
  error: unknown
): UrlDownloadFailureCategory {
  const value = error as {
    message?: unknown;
    userFriendly?: unknown;
    code?: unknown;
  };
  const text = `${String(value?.message || '')}\n${String(
    value?.userFriendly || ''
  )}\n${String(value?.code || '')}`.toLowerCase();

  if (/invalid url|url format/.test(text)) return 'validation';
  if (
    /yt-dlp binary|javascript runtime|could not find\/provide|not executable/.test(
      text
    )
  ) {
    return 'runtime_setup';
  }
  if (
    /output directory|persistent download storage|could not be saved|eacces|enospc|no space/.test(
      text
    )
  ) {
    return 'storage';
  }
  if (/ffmpeg|postprocess|merge|conversion/.test(text)) {
    return 'postprocessing';
  }
  if (
    /unsupported url|private video|video unavailable|not available|members-only|age-restricted|http error 403|\b403\b.*forbidden|forbidden.*\b403\b/.test(
      text
    )
  ) {
    return 'site_rejected';
  }
  if (
    /timeout|timed out|network|connection|dns|econn|enet|socket|http error/.test(
      text
    )
  ) {
    return 'network';
  }
  return 'unknown';
}

export function shouldAutoCompleteYouTubeConnection({
  hadAuthAtOpen,
  hasAuthNow,
  currentUrl,
}: {
  hadAuthAtOpen: boolean;
  hasAuthNow: boolean;
  currentUrl: string;
}): boolean {
  return (
    !hadAuthAtOpen && hasAuthNow && isYouTubeHostname(hostname(currentUrl))
  );
}

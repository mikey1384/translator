export type UrlDownloadFailureCode =
  | 'http_403_media'
  | 'http_403_source'
  | 'http_403_unknown'
  | 'http_429'
  | 'login_required'
  | 'human_verification'
  | 'private_or_restricted'
  | 'network'
  | 'unknown';

export type UrlDownloadFailurePhase =
  | 'media_transfer'
  | 'source_access'
  | 'unknown';

export type UrlDownloadFailureDetail = {
  code: UrlDownloadFailureCode;
  phase: UrlDownloadFailurePhase;
  httpStatus: 403 | 429 | null;
  canAttemptPublicAutomaticCaptions: boolean;
};

type ErrorLike = {
  message?: unknown;
  stderr?: unknown;
  stdout?: unknown;
  all?: unknown;
  userFriendly?: unknown;
};

export function getUrlDownloadErrorText(error: unknown): string {
  const value = error as ErrorLike;
  return [
    value?.message,
    value?.stderr,
    value?.stdout,
    value?.all,
    value?.userFriendly,
  ]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Classifies only stable, local failure signals. Raw yt-dlp output remains in
 * logs and is never returned as analytics content.
 *
 * Caption-only recovery is deliberately narrower than "any 403": it is
 * allowed only when yt-dlp reached the media-transfer phase. A webpage,
 * player/API, login, private-video, or otherwise ambiguous 403 is never used
 * to trigger a second access path.
 */
export function classifyUrlDownloadFailureDetail(
  error: unknown
): UrlDownloadFailureDetail {
  const text = getUrlDownloadErrorText(error).toLowerCase();
  const has403 =
    /\bhttp(?: error)?\s*:?\s*403\b|\bstatus(?: code)?\s*:?\s*403\b|\b403\s*:?\s*forbidden\b/.test(
      text
    );
  const has429 =
    /\b(?:http(?: error)?\s*:?\s*)?429\b|too\s+many\s+requests|rate[- ]?limit/.test(
      text
    );
  const loginRequired =
    /login_required|authentication\s*required|sign\s*in\s*to\s*confirm|members[- ]only|age[- ]restricted/.test(
      text
    );
  const humanVerification =
    /captcha|recaptcha|verify\s*(?:you|you'?re).*(?:human|not\s+a\s+bot)|confirm\s*(?:you|you'?re).*not\s+a\s+bot|human\s*verification|challenge\s*required/.test(
      text
    );
  const privateOrRestricted =
    /private video|this video is private|video unavailable|geo[- ]restricted|region[- ]locked/.test(
      text
    );
  const sourceAccessFailure =
    /unable to download (?:webpage|api page|player|initial data|player api json)|extractor error|failed to extract/.test(
      text
    );
  const mediaTransferFailure =
    /unable to download video data|\[download\].*(?:http(?: error)?\s*403|forbidden)|fragment[^\n]*(?:http(?: error)?\s*403|forbidden)|media (?:bytes|stream)[^\n]*(?:403|forbidden)/.test(
      text
    );

  if (humanVerification) {
    return {
      code: 'human_verification',
      phase: 'source_access',
      httpStatus: has403 ? 403 : has429 ? 429 : null,
      canAttemptPublicAutomaticCaptions: false,
    };
  }
  if (loginRequired) {
    return {
      code: 'login_required',
      phase: 'source_access',
      httpStatus: has403 ? 403 : has429 ? 429 : null,
      canAttemptPublicAutomaticCaptions: false,
    };
  }
  if (privateOrRestricted) {
    return {
      code: 'private_or_restricted',
      phase: 'source_access',
      httpStatus: has403 ? 403 : null,
      canAttemptPublicAutomaticCaptions: false,
    };
  }
  if (has429) {
    return {
      code: 'http_429',
      phase: 'source_access',
      httpStatus: 429,
      canAttemptPublicAutomaticCaptions: false,
    };
  }
  if (has403 && sourceAccessFailure) {
    return {
      code: 'http_403_source',
      phase: 'source_access',
      httpStatus: 403,
      canAttemptPublicAutomaticCaptions: false,
    };
  }
  if (has403 && mediaTransferFailure) {
    return {
      code: 'http_403_media',
      phase: 'media_transfer',
      httpStatus: 403,
      canAttemptPublicAutomaticCaptions: true,
    };
  }
  if (has403) {
    return {
      code: 'http_403_unknown',
      phase: 'unknown',
      httpStatus: 403,
      canAttemptPublicAutomaticCaptions: false,
    };
  }
  if (
    /failed to resolve|could not resolve host|getaddrinfo|network is unreachable|econn|enet|socket|timed?\s*out/.test(
      text
    )
  ) {
    return {
      code: 'network',
      phase: 'unknown',
      httpStatus: null,
      canAttemptPublicAutomaticCaptions: false,
    };
  }

  return {
    code: 'unknown',
    phase: 'unknown',
    httpStatus: null,
    canAttemptPublicAutomaticCaptions: false,
  };
}

import log from 'electron-log';

export function mapErrorToUserFriendly({
  rawErrorMessage,
  stderrContent = '',
}: {
  rawErrorMessage: string;
  stderrContent?: string;
}): string {
  const combinedErrorText =
    `${rawErrorMessage}\n${stderrContent}`.toLowerCase();

  if (combinedErrorText.includes('unsupported url')) {
    return 'This website or URL is not supported.';
  } else if (combinedErrorText.includes('video unavailable')) {
    return 'This video is unavailable.';
  } else if (combinedErrorText.includes('this video is private')) {
    return 'This video is private.';
  } else if (combinedErrorText.includes('http error 404')) {
    return 'Video not found at this URL (404 Error).';
  } else if (combinedErrorText.includes('invalid url')) {
    return 'The URL format appears invalid.';
  } else if (
    combinedErrorText.includes('name or service not known') ||
    combinedErrorText.includes('temporary failure in name resolution') ||
    combinedErrorText.includes('network is unreachable')
  ) {
    return 'Network error. Please check your internet connection.';
  } else if (combinedErrorText.includes('unable to download video data')) {
    return 'Failed to download video data. The video might be region-locked or require login.';
  } else if (
    /http error 429|too\s+many\s+requests|looks suspicious|verify you are human/.test(
      combinedErrorText
    )
  ) {
    return 'YouTube is rate-limiting this network (HTTP 429) or blocking automated requests. Please wait and try again.';
  }

  log.info(
    `[URLprocessor] No specific error mapping for: "${rawErrorMessage}"`
  );
  return rawErrorMessage;
}

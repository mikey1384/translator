const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function shouldSendProductAnalytics({
  isPackaged,
  appVersion,
}: {
  isPackaged: boolean;
  appVersion: string;
}): boolean {
  const normalizedVersion = String(appVersion || '').trim();
  return (
    isPackaged &&
    normalizedVersion !== '0.0.0' &&
    RELEASE_VERSION.test(normalizedVersion)
  );
}

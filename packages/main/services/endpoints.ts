const DEFAULT_STAGE5_API_URL = 'https://api.stage5.tools';
const DEFAULT_RELAY_URL = 'https://translator-relay.fly.dev';

function normalizeBaseUrl(value: string, fallback: string): string {
  const normalized = String(value || '')
    .trim()
    .replace(/\/+$/, '');
  return normalized || fallback;
}

function getEndpointFromEnv(
  key: string,
  fallback: string,
  legacyKey?: string
): string {
  const fromPrimary = process.env[key];
  const fromLegacy = legacyKey ? process.env[legacyKey] : undefined;
  return normalizeBaseUrl(fromPrimary ?? fromLegacy ?? fallback, fallback);
}

export const STAGE5_API_URL = getEndpointFromEnv(
  'STAGE5_API_URL',
  DEFAULT_STAGE5_API_URL
);

export const RELAY_URL = getEndpointFromEnv(
  'STAGE5_RELAY_URL',
  DEFAULT_RELAY_URL,
  'RELAY_URL'
);

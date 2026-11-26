import { isIP } from 'node:net';

const PROTOCOL = 'stage5-translator:';
const MAX_URL_LENGTH = 4096;

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!normalized) return true;
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const parts = normalized.split('.').map(part => Number.parseInt(part, 10));
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (ipVersion === 6) {
    if (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    ) {
      return true;
    }
    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
    if (normalized.startsWith('::ffff:')) {
      return isPrivateOrLoopbackHost(normalized.slice('::ffff:'.length));
    }
    return false;
  }

  return false;
}

/**
 * Parse and strictly validate a `stage5-translator://open?url=...` deep link
 * (such as from the 1-click browser bookmarklet).
 *
 * Accepts only public http(s) URLs up to 4,096 characters; rejects file:,
 * javascript:, data:, credentials, and private/loopback hosts.
 */
export function parseOpenVideoDeepLink(rawUrl: string): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH * 2) return null;

  let outer: URL;
  try {
    outer = new URL(trimmed);
  } catch {
    return null;
  }
  if (outer.protocol.toLowerCase() !== PROTOCOL) return null;

  const route =
    `${outer.hostname.toLowerCase()}${outer.pathname.toLowerCase()}`.replace(
      /^\/+|\/+$/g,
      ''
    );
  if (route !== 'open') return null;

  const targetRaw = (outer.searchParams.get('url') || '').trim();
  if (!targetRaw || targetRaw.length > MAX_URL_LENGTH) return null;

  let target: URL;
  try {
    target = new URL(targetRaw);
  } catch {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  if (target.username || target.password) return null;
  if (isPrivateOrLoopbackHost(target.hostname)) return null;

  const canonical = target.toString();
  if (canonical.length > MAX_URL_LENGTH) return null;
  return canonical;
}

/**
 * A local path as a file:// URL the renderer can load. Each path segment is
 * percent-encoded, so "#", "?" and "%" in a filename stay part of the path:
 * encodeURI left "#nba #espn [id].mp4" (a TikTok title) as a URL fragment,
 * and the player showed "Media playback error" for a valid file.
 */
export function toFileUrl(p: string): string {
  if (!p) return p;
  if (p.startsWith('file://')) return p;
  const normalized = p.replace(/\\/g, '/');
  const drive = /^[a-zA-Z]:(?=\/)/.exec(normalized)?.[0] ?? '';
  const rest = normalized.slice(drive.length);
  const encoded = (rest.startsWith('/') ? rest : `/${rest}`)
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return drive ? `file:///${drive}${encoded}` : `file://${encoded}`;
}

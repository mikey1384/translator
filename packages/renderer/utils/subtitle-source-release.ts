import { mountedSubtitleMatchesVideoSource } from './subtitle-source-association';

type MountedSubtitleState = {
  order: string[];
  sourceVideoPath?: string | null;
  sourceVideoAssetIdentity?: string | null;
  sourceUrl?: string | null;
};

/**
 * True when the mounted subtitles were made for a different video than the
 * one just opened, so they must not stay on screen (or be exported) over it.
 * Subtitles tied to no video at all (an .srt opened before choosing the
 * video) stay: the user is pairing them with this video.
 */
export function subtitlesBelongToOtherSource(
  subtitles: MountedSubtitleState,
  next: {
    sourceVideoPath?: string | null;
    sourceVideoAssetIdentity?: string | null;
    sourceUrl?: string | null;
  }
): boolean {
  if (!Array.isArray(subtitles.order) || subtitles.order.length === 0) {
    return false;
  }
  const mountedUrl = String(subtitles.sourceUrl || '').trim();
  const hasAssociation = Boolean(
    String(subtitles.sourceVideoPath || '').trim() ||
    String(subtitles.sourceVideoAssetIdentity || '').trim() ||
    mountedUrl
  );
  if (!hasAssociation) return false;
  if (mountedSubtitleMatchesVideoSource(subtitles, next)) return false;
  const nextUrl = String(next.sourceUrl || '').trim();
  if (mountedUrl && nextUrl && mountedUrl === nextUrl) return false;
  return true;
}

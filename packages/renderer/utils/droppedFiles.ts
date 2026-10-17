import {
  hasMediaFileExtension,
  hasSubtitleFileExtension,
} from '../../shared/constants/media-extensions.js';

export type DroppedFileKind = 'media' | 'subtitle' | 'other';

export function classifyDroppedFile(file: {
  name: string;
  type?: string;
}): DroppedFileKind {
  if (hasSubtitleFileExtension(file.name)) return 'subtitle';
  const type = String(file.type || '');
  if (type.startsWith('video/') || type.startsWith('audio/')) return 'media';
  return hasMediaFileExtension(file.name) ? 'media' : 'other';
}

/**
 * The file a drop should act on: the first video/audio file, else the first
 * .srt, else the first file (so the message can say it isn't supported).
 */
export function pickDroppedFile<T extends { name: string; type?: string }>(
  files: readonly T[]
): { file: T; kind: DroppedFileKind } | null {
  if (files.length === 0) return null;
  const media = files.find(file => classifyDroppedFile(file) === 'media');
  if (media) return { file: media, kind: 'media' };
  const subtitle = files.find(file => classifyDroppedFile(file) === 'subtitle');
  if (subtitle) return { file: subtitle, kind: 'subtitle' };
  return { file: files[0], kind: 'other' };
}

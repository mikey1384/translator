/**
 * Every audio/video file extension Translator opens. The file picker, home
 * drops and workspace drops all use this one list, so a file that can be
 * dropped can also be chosen.
 */
export const MEDIA_FILE_EXTENSIONS = [
  'mp4',
  'mov',
  'm4v',
  'mkv',
  'webm',
  'avi',
  'wmv',
  'flv',
  'mpg',
  'mpeg',
  'ts',
  'mts',
  'm2ts',
  '3gp',
  'mp3',
  'wav',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'opus',
] as const;

const MEDIA_EXTENSION_SET = new Set<string>(MEDIA_FILE_EXTENSIONS);

export function fileExtension(name: string): string {
  const base =
    String(name || '')
      .split(/[\\/]/)
      .pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** True for a file name (or path) with a media extension. */
export function hasMediaFileExtension(name: string): boolean {
  return MEDIA_EXTENSION_SET.has(fileExtension(name));
}

/** True for a subtitle file Translator can mount. */
export function hasSubtitleFileExtension(name: string): boolean {
  return fileExtension(name) === 'srt';
}

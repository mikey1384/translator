// eslint-disable-next-line no-control-regex -- control characters are unsafe in file names
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001f]+/g;

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function dirname(path: string): string | null {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut > 0 ? path.slice(0, cut + 1) : null;
}

/**
 * The name Save As suggests for subtitles with no file yet: the video's name
 * plus the subtitle language, next to the video (e.g. `tos30.korean.srt`).
 * A video in the app's temp download folder only lends its name.
 */
export function suggestSubtitleFilePath({
  videoPath,
  title,
  language,
  videoInTempFolder = false,
}: {
  videoPath?: string | null;
  title?: string | null;
  language?: string | null;
  videoInTempFolder?: boolean;
}): string {
  const source = String(videoPath || '').trim();
  const rawBase = source
    ? stripExtension(basename(source))
    : stripExtension(String(title || '').trim());
  const base =
    rawBase.replace(UNSAFE_FILE_CHARS, ' ').replace(/\s+/g, ' ').trim() ||
    'subtitles';
  const lang = String(language || '')
    .trim()
    .toLowerCase()
    .replace(UNSAFE_FILE_CHARS, '')
    .replace(/\s+/g, '-');
  const fileName =
    lang && lang !== 'original' ? `${base}.${lang}.srt` : `${base}.srt`;
  const folder = source && !videoInTempFolder ? dirname(source) : null;
  return folder ? `${folder}${fileName}` : fileName;
}

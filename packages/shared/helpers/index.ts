import { SrtSegment } from '@shared-types/app';

export function srtStringToSeconds(raw: string): number {
  const m = raw.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!m) return 0;
  const [, hh, mm, ss, ms] = m.map(Number);
  return hh * 3600 + mm * 60 + ss + ms / 1000;
}

export class SubtitleProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubtitleProcessingError';
  }
}

export function parseSrt(srtString: string): SrtSegment[] {
  if (!srtString?.trim()) return [];

  const out: SrtSegment[] = [];

  const blocks = srtString
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean);

  blocks.forEach((block, fallbackIdx) => {
    const lines = block.trim().split(/\r?\n/);
    if (lines.length < 3) return;

    /* header */
    const index = Number(lines[0].trim()) || fallbackIdx + 1;
    const timeMatch = lines[1].match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
    );
    if (!timeMatch) return;

    const start = srtTimeToSeconds(timeMatch[1]);
    const end = srtTimeToSeconds(timeMatch[2]);
    if (isNaN(start) || isNaN(end)) return;

    const textLines = lines.slice(2).map(l => l.replace(/\\n/g, '\n').trim());
    const original = textLines[0] ?? '';
    const translation = textLines.length === 2 ? textLines[1] : undefined;

    out.push({
      id: crypto.randomUUID(),
      index,
      start,
      end,
      original,
      translation,
    });
  });

  return out;
}

export function buildSrt({
  segments,
  mode = 'dual',
}: {
  segments: SrtSegment[];
  mode?: 'original' | 'translation' | 'dual';
}): string {
  if (!segments?.length) return '';

  return segments
    .map((seg, i) => {
      const idx = seg.index ?? i + 1;
      const start = secondsToSrtTime(seg.start);
      const end = secondsToSrtTime(seg.end);
      const cue = cueText(seg, mode);

      return `${idx}\n${start} --> ${end}\n${cue}`;
    })
    .join('\n\n');
}

export function cueText(
  seg: SrtSegment,
  mode: 'original' | 'translation' | 'dual'
): string {
  const hasTrans = !!seg.translation && seg.translation.trim() !== '';

  switch (mode) {
    case 'original':
      return seg.original || seg.translation || '';

    case 'translation':
      return hasTrans ? seg.translation! : seg.original;

    case 'dual':
    default:
      return hasTrans ? `${seg.original}\n${seg.translation}` : seg.original;
  }
}

export function srtTimeToSeconds(timeString: string): number {
  if (!timeString) return 0;
  const parts = timeString.split(',');
  if (parts.length !== 2) return 0;
  const [time, msStr] = parts;
  const timeParts = time.split(':');
  if (timeParts.length !== 3) return 0;
  const [hoursStr, minutesStr, secondsStr] = timeParts;

  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);
  const seconds = parseInt(secondsStr, 10);
  const ms = parseInt(msStr, 10);

  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds) || isNaN(ms)) {
    return 0;
  }

  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

/**
 * Convert seconds to SRT time format (00:00:00,000)
 */
export function secondsToSrtTime(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00:00,000';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor((totalSeconds % 1) * 1000);

  const finalSeconds = milliseconds === 1000 ? seconds + 1 : seconds;
  const finalMilliseconds = milliseconds === 1000 ? 0 : milliseconds;

  const finalMinutes = finalSeconds === 60 ? minutes + 1 : minutes;
  const finalSecondsAdjusted = finalSeconds === 60 ? 0 : finalSeconds;

  const finalHours = finalMinutes === 60 ? hours + 1 : hours;
  const finalMinutesAdjusted = finalMinutes === 60 ? 0 : finalMinutes;

  return `${String(finalHours).padStart(2, '0')}:${String(
    finalMinutesAdjusted
  ).padStart(2, '0')}:${String(finalSecondsAdjusted).padStart(2, '0')},${String(
    finalMilliseconds
  ).padStart(3, '0')}`;
}

export function fixOverlappingSegments(segments: SrtSegment[]): SrtSegment[] {
  if (!segments || segments.length <= 1) return segments;

  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sortedSegments.length - 1; i++) {
    const current = sortedSegments[i];
    const next = sortedSegments[i + 1];
    if (current.end > next.start) {
      current.end = Math.max(current.start + 0.1, next.start - 0.05);
    }
  }

  return sortedSegments;
}

export function formatTimeForDisplay(seconds: number): string {
  if (isNaN(seconds)) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export async function openSubtitleWithElectron(): Promise<{
  file?: File;
  content?: string;
  segments?: SrtSegment[];
  filePath?: string;
  error?: string;
}> {
  try {
    const { openFile } = await import('./electron-ipc');
    const result = await openFile({
      filters: [{ name: 'Subtitle Files', extensions: ['srt'] }],
      title: 'Open Subtitle File',
    });

    if (
      result.canceled ||
      !result.filePaths?.length ||
      !result.fileContents?.length
    ) {
      return { error: 'File selection was canceled' };
    }

    const filePath = result.filePaths[0];
    const content = result.fileContents[0];
    const filename = filePath.split('/').pop() || 'subtitles.srt';
    const file = new File([content], filename, { type: 'text/plain' });

    localStorage.setItem('loadedSrtFileName', filename);
    localStorage.setItem('originalSrtPath', filePath);
    localStorage.setItem('originalLoadPath', filePath);

    const segments = parseSrt(content);

    return {
      file,
      content,
      segments,
      filePath,
    };
  } catch (error: any) {
    const message = error.message || String(error);
    console.error('Error opening subtitle file:', message);
    return { error: `Failed to open subtitle file: ${message}` };
  }
}

export const validateSubtitleTimings = (
  subtitles: SrtSegment[]
): SrtSegment[] => {
  if (!subtitles || subtitles.length === 0) return [];
  return subtitles.map(subtitle => {
    const fixed = { ...subtitle };
    if (fixed.start < 0) fixed.start = 0;
    if (fixed.end <= fixed.start) fixed.end = fixed.start + 0.5;
    return fixed;
  });
};

import { SrtSegment } from '../../types/interface';

/**
 * Parse SRT content to an array of segments
 */
export function parseSrt(srtString: string): SrtSegment[] {
  if (!srtString) return [];

  const segments: SrtSegment[] = [];
  const blocks = srtString
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(block => block.trim() !== '');

  blocks.forEach((block, _blockIndex) => {
    const lines = block.trim().split(/\r?\n/);
    if (lines.length < 3) {
      return;
    }

    const indexLine = lines[0].trim();
    const timeLine = lines[1].trim();
    const textLines = lines.slice(2);
    const text = textLines.join('\n').trim();

    const index = parseInt(indexLine, 10);
    const timeMatch = timeLine.match(
      /(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)/
    );

    if (isNaN(index)) {
      return;
    }
    if (!timeMatch) {
      return;
    }
    if (text === '') {
      // Allow empty text content, no action needed
    }

    const startTime = srtTimeToSeconds(timeMatch[1]);
    const endTime = srtTimeToSeconds(timeMatch[2]);

    segments.push({
      index,
      start: startTime,
      end: endTime,
      text,
    });
  });

  return validateSubtitleTimings(segments);
}

/**
 * Validates subtitle timings and fixes any issues
 * Ensures that:
 * 1. No subtitle has end time before start time
 * 2. No subtitle has negative start time
 * 3. Subtitles don't overlap (if fixOverlaps is true)
 */
export function validateSubtitleTimings(
  subtitles: SrtSegment[],
  fixOverlaps: boolean = true
): SrtSegment[] {
  if (!subtitles || subtitles.length === 0) return [];

  const fixedSubtitles = subtitles.map(subtitle => {
    const fixed = { ...subtitle };
    if (fixed.start < 0) fixed.start = 0;
    if (fixed.end <= fixed.start) fixed.end = fixed.start + 0.5;
    return fixed;
  });

  if (fixOverlaps) {
    fixedSubtitles.sort((a, b) => a.start - b.start);

    for (let i = 0; i < fixedSubtitles.length - 1; i++) {
      const current = fixedSubtitles[i];
      const next = fixedSubtitles[i + 1];

      if (current.end > next.start) {
        const midPoint = (current.end + next.start) / 2;
        const newCurrentEnd = Math.min(midPoint, next.start - 0.1);
        const minCurrentEnd = current.start + 0.5;

        if (newCurrentEnd >= minCurrentEnd) {
          current.end = newCurrentEnd;
        } else {
          next.start = current.start + 0.5;
          current.end = current.start + 0.4;
        }
      }
    }

    fixedSubtitles.forEach((subtitle, index) => {
      subtitle.index = index + 1;
    });
  }

  return fixedSubtitles;
}

/**
 * Build SRT content from segments
 */
export function buildSrt(segments: SrtSegment[]): string {
  if (segments.length === 0) return '';

  return segments
    .map((segment, i) => {
      const index = segment.index || i + 1;
      const startTime = secondsToSrtTime(segment.start);
      const endTime = secondsToSrtTime(segment.end);
      return `${index}\n${startTime} --> ${endTime}\n${segment.text}`;
    })
    .join('\n\n');
}

/**
 * Convert SRT time format (00:00:00,000) to seconds
 */
export function srtTimeToSeconds(timeString: string): number {
  const [time, ms] = timeString.split(',');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds + parseInt(ms, 10) / 1000;
}

/**
 * Convert seconds to SRT time format (00:00:00,000)
 */
export function secondsToSrtTime(totalSeconds: number): string {
  if (isNaN(totalSeconds)) return '00:00:00,000';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.round((totalSeconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(
    2,
    '0'
  )}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(
    3,
    '0'
  )}`;
}

/**
 * Check for and fix overlapping segments
 */
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

/**
 * Format a time for display (compact format)
 */
export function formatTimeForDisplay(seconds: number): string {
  if (isNaN(seconds)) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Opens a subtitle file using Electron's native file dialog
 */
export async function openSubtitleWithElectron(): Promise<{
  file?: File;
  content?: string;
  segments?: SrtSegment[];
  filePath?: string;
  error?: string;
}> {
  try {
    const result = await window.electron.openFile({
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

    return { file, content, segments, filePath };
  } catch (error) {
    const errorMessage = String(error);
    return { error: errorMessage };
  }
}

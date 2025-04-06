import { SrtSegment } from '../../types/interface.js';

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
    const text = textLines.join('\\n').trim();

    const index = parseInt(indexLine, 10);
    const timeMatch = timeLine.match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
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

    // Use srtTimeToSeconds to correctly parse the time strings
    const startTime = srtTimeToSeconds(timeMatch[1]);
    const endTime = srtTimeToSeconds(timeMatch[2]);

    // Basic validation for parsed times
    if (isNaN(startTime) || isNaN(endTime)) {
      return;
    }

    segments.push({
      index,
      start: startTime,
      end: endTime,
      text,
    });
  });

  return segments;
}

/**
 * Build SRT content from segments
 */
export function buildSrt(segments: SrtSegment[]): string {
  if (segments.length === 0) return '';

  return segments
    .map((segment, i) => {
      const index = segment.index || i + 1;
      const startTimeStr = secondsToSrtTime(segment.start);
      const endTimeStr = secondsToSrtTime(segment.end);
      return `${index}\n${startTimeStr} --> ${endTimeStr}\n${segment.text}`;
    })
    .join('\n\n');
}

/**
 * Convert SRT time format (00:00:00,000) to seconds
 */
export function srtTimeToSeconds(timeString: string): number {
  if (!timeString) return 0; // Add guard for empty/undefined string
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
    return 0; // Return 0 if parsing fails
  }

  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

/**
 * Convert seconds to SRT time format (00:00:00,000)
 */
export function secondsToSrtTime(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00:00,000'; // Handle NaN and negative

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.round((totalSeconds % 1) * 1000);

  // Ensure milliseconds don't exceed 999 after rounding
  const finalSeconds = milliseconds === 1000 ? seconds + 1 : seconds;
  const finalMilliseconds = milliseconds === 1000 ? 0 : milliseconds;

  // Recalculate minutes/hours if seconds wrapped around
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

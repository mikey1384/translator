import { SrtSegment } from '../../types/interface';

/**
 * Parse SRT content to an array of segments
 */
export function parseSrt(srtString: string): SrtSegment[] {
  if (!srtString) return [];

  const segments: SrtSegment[] = [];
  const blocks = srtString.trim().split(/\r?\n\r?\n/);

  blocks.forEach(block => {
    const lines = block.split(/\r?\n/);
    if (lines.length < 3) return;

    const index = parseInt(lines[0].trim(), 10);
    const timeMatch = lines[1].match(
      /(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)/
    );
    if (!timeMatch) return;

    const startTime = srtTimeToSeconds(timeMatch[1]);
    const endTime = srtTimeToSeconds(timeMatch[2]);
    const text = lines.slice(2).join('\n');

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
 * Adjust SRT time by a specified offset (in seconds)
 */
export function adjustTimeString(
  timeString: string,
  offsetSeconds: number
): string {
  if (!timeString) return '00:00:00,000';
  const seconds = srtTimeToSeconds(timeString);
  return secondsToSrtTime(Math.max(0, seconds + offsetSeconds));
}

/**
 * Check if two time ranges overlap
 */
export function doTimeRangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return Math.max(startA, startB) < Math.min(endA, endB);
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
 * Load SRT file content using Electron's native file dialog if available,
 * or fall back to traditional browser file input
 */
export async function loadSrtFile(
  file?: File,
  onContentLoaded?: (
    content: string,
    segments: SrtSegment[],
    filePath?: string
  ) => void,
  onError?: (error: string) => void
): Promise<{
  content?: string;
  segments?: SrtSegment[];
  filePath?: string;
  error?: string;
}> {
  try {
    if (!file && window.electron?.openFile) {
      const result = await window.electron.openFile({
        title: 'Open SRT File',
        filters: [{ name: 'SRT Files', extensions: ['srt'] }],
      });

      if (result.canceled) return { error: 'Operation canceled' };
      if (result.error) {
        if (onError) onError(result.error);
        return { error: result.error };
      }
      if (!result.filePaths?.length) {
        if (onError) onError('No file was selected');
        return { error: 'No file was selected' };
      }
      if (!result.fileContents?.length) {
        if (onError) onError('Could not read file content');
        return { error: 'Could not read file content' };
      }

      const filePath = result.filePaths[0];
      const content = result.fileContents[0];
      localStorage.setItem('targetPath', filePath);
      localStorage.setItem('originalLoadPath', filePath);

      const segments = parseSrt(content);
      if (onContentLoaded) onContentLoaded(content, segments, filePath);

      return { content, segments, filePath };
    }

    if (file) {
      const fakePath = `/temp/${file.name}`;
      localStorage.setItem('originalSrtPath', fakePath);

      return new Promise(resolve => {
        const reader = new FileReader();

        reader.onload = e => {
          const content = e.target?.result as string;
          if (!content) {
            if (onError) onError('Could not read file content');
            resolve({ error: 'Could not read file content' });
            return;
          }

          const segments = parseSrt(content);
          if (onContentLoaded) onContentLoaded(content, segments, fakePath);
          resolve({ content, segments, filePath: fakePath });
        };

        reader.onerror = () => {
          if (onError) onError('Error reading SRT file');
          resolve({ error: 'Error reading SRT file' });
        };

        reader.readAsText(file);
      });
    }

    if (onError) onError('No file was provided');
    return { error: 'No file was provided' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (onError) onError(errorMessage);
    return { error: errorMessage };
  }
}

/**
 * Safely call Electron IPC with retries for "No handler registered" errors
 */
export async function retryElectronCall<T>(
  method: string,
  args: any,
  maxRetries = 5,
  initialDelay = 300
): Promise<T> {
  if (!window.electron) throw new Error('Electron API not available');

  const electronMethod = (window.electron as any)[method];
  if (!electronMethod)
    throw new Error(`Method ${method} not available in Electron API`);

  try {
    return await electronMethod(args);
  } catch (error: any) {
    if (!error.message?.includes('No handler registered')) throw error;

    let delay = initialDelay;
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(resolve => setTimeout(resolve, delay));
      try {
        return await electronMethod(args);
      } catch (retryError: any) {
        if (!retryError.message?.includes('No handler registered'))
          throw retryError;
        delay *= 1.5;
      }
    }
    throw new Error(`Failed to call ${method} after ${maxRetries} retries`);
  }
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

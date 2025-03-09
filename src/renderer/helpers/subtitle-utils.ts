import { SrtSegment } from "../App";

/**
 * Parse SRT content to an array of segments
 */
export function parseSrt(srtString: string): SrtSegment[] {
  if (!srtString) return [];

  const segments: SrtSegment[] = [];
  const blocks = srtString.trim().split(/\r?\n\r?\n/);

  blocks.forEach((block) => {
    const lines = block.split(/\r?\n/);
    if (lines.length < 3) return;

    // Parse index (first line)
    const index = parseInt(lines[0].trim(), 10);

    // Parse timestamp (second line)
    const timeMatch = lines[1].match(
      /(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)/
    );
    if (!timeMatch) return;

    const startTime = srtTimeToSeconds(timeMatch[1]);
    const endTime = srtTimeToSeconds(timeMatch[2]);

    // Get subtitle text (remaining lines)
    const text = lines.slice(2).join("\n");

    segments.push({
      index,
      start: startTime,
      end: endTime,
      text,
    });
  });

  // Validate and fix any timing issues
  return validateSubtitleTimings(segments);
}

/**
 * Validates subtitle timings and fixes any issues
 * This ensures that:
 * 1. No subtitle has end time before start time
 * 2. No subtitle has negative start time
 * 3. Subtitles don't overlap (if fixOverlaps is true)
 */
export function validateSubtitleTimings(
  subtitles: SrtSegment[],
  fixOverlaps: boolean = true
): SrtSegment[] {
  if (!subtitles || subtitles.length === 0) return [];


  // First pass: fix basic timing issues (negative times, end before start)
  const fixedSubtitles = subtitles.map((subtitle) => {
    // Create a new object to avoid mutating the original
    const fixed = { ...subtitle };

    // Fix negative start time
    if (fixed.start < 0) {
      fixed.start = 0;
    }

    // Fix end time before or equal to start time
    if (fixed.end <= fixed.start) {
      // Make the subtitle last at least 0.5 seconds
      fixed.end = fixed.start + 0.5;
    }

    return fixed;
  });

  // Second pass: fix overlaps if requested
  if (fixOverlaps) {
    // Sort by start time
    fixedSubtitles.sort((a, b) => a.start - b.start);

    for (let i = 0; i < fixedSubtitles.length - 1; i++) {
      const current = fixedSubtitles[i];
      const next = fixedSubtitles[i + 1];

      // Check for overlap
      if (current.end > next.start) {

        // Find a middle point
        const midPoint = (current.end + next.start) / 2;

        // Adjust times - ensure minimum duration of 0.5s
        const newCurrentEnd = Math.min(midPoint, next.start - 0.1);
        const minCurrentEnd = current.start + 0.5;

        if (newCurrentEnd >= minCurrentEnd) {
          current.end = newCurrentEnd;
        } else {
          // If we can't maintain minimum duration, adjust the next subtitle instead
          next.start = current.start + 0.5;
          current.end = current.start + 0.4;
        }
      }
    }

    // Re-index based on start time
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
  if (segments.length === 0) return "";

  return segments
    .map((segment, i) => {
      const index = segment.index || i + 1;
      const startTime = secondsToSrtTime(segment.start);
      const endTime = secondsToSrtTime(segment.end);
      return `${index}\n${startTime} --> ${endTime}\n${segment.text}`;
    })
    .join("\n\n");
}

/**
 * Convert SRT time format (00:00:00,000) to seconds
 */
export function srtTimeToSeconds(timeString: string): number {
  const parts = timeString.split(",");
  const timeParts = parts[0].split(":");

  const hours = parseInt(timeParts[0], 10);
  const minutes = parseInt(timeParts[1], 10);
  const seconds = parseInt(timeParts[2], 10);
  const milliseconds = parseInt(parts[1], 10);

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

/**
 * Convert seconds to SRT time format (00:00:00,000)
 */
export function secondsToSrtTime(totalSeconds: number): string {
  if (isNaN(totalSeconds)) return "00:00:00,000";

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds - hours * 3600) / 60);
  const seconds = Math.floor(totalSeconds - hours * 3600 - minutes * 60);
  const milliseconds = Math.round(
    (totalSeconds - Math.floor(totalSeconds)) * 1000
  );

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(
    3,
    "0"
  )}`;
}

/**
 * Adjust SRT time by a specified offset (in seconds)
 */
export function adjustTimeString(
  timeString: string,
  offsetSeconds: number
): string {
  if (!timeString) return "00:00:00,000";

  const seconds = srtTimeToSeconds(timeString);
  const adjustedSeconds = Math.max(0, seconds + offsetSeconds);
  return secondsToSrtTime(adjustedSeconds);
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
  if (isNaN(seconds)) return "00:00";

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
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
      // Adjust the current segment's end time to match the next segment's start time
      // with a small buffer
      current.end = Math.max(current.start + 0.1, next.start - 0.05);
    }
  }

  return sortedSegments;
}

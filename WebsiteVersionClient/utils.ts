import { SrtSegment } from '~/types';

export function buildSrt(segments: SrtSegment[]): string {
  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return '';
  }

  // Sort segments by start time and ensure valid data
  const validSegments = segments
    .filter(
      (seg) =>
        typeof seg.start === 'number' &&
        typeof seg.end === 'number' &&
        !isNaN(seg.start) &&
        !isNaN(seg.end) &&
        seg.start >= 0 &&
        seg.end > seg.start
    )
    .sort((a, b) => a.start - b.start);

  if (validSegments.length === 0) {
    return '';
  }

  return validSegments
    .map((seg, i) => {
      const index = i + 1;
      const startStr = secondsToSrtTime(seg.start);
      const endStr = secondsToSrtTime(seg.end);
      return `${index}\n${startStr} --> ${endStr}\n${(
        seg.text || ''
      ).trim()}\n`;
    })
    .join('\n');
}

export function secondsToSrtTime(totalSec: number): string {
  if (isNaN(totalSec) || totalSec < 0) {
    totalSec = 0;
  }

  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = Math.floor(totalSec % 60);
  const milliseconds = Math.round((totalSec - Math.floor(totalSec)) * 1000);
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const mmm = String(milliseconds).padStart(3, '0');
  return `${hh}:${mm}:${ss},${mmm}`;
}

export function parseSrt(
  srtString: string,
  targetLanguage: string = 'original',
  showOriginalText: boolean = true
): SrtSegment[] {
  if (!srtString || typeof srtString !== 'string') {
    return [];
  }

  const segments: SrtSegment[] = [];
  // Normalize line endings and handle different formats
  const normalizedSrt = srtString.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalizedSrt.trim().split(/\n\s*\n/);

  blocks.forEach((block, blockIndex) => {
    if (!block.trim()) return;

    const lines = block.split('\n');
    if (lines.length < 2) return;

    // Find the timing line (contains -->)
    const timingLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingLineIndex === -1) return;

    // Parse index (use block index + 1 if not a valid number)
    const indexLine = lines[0].trim();
    const index = /^\d+$/.test(indexLine)
      ? parseInt(indexLine, 10)
      : blockIndex + 1;

    // Parse timing
    const timingLine = lines[timingLineIndex].trim();
    const timeParts = timingLine.split('-->');
    if (timeParts.length !== 2) return;

    const startStr = timeParts[0]?.trim();
    const endStr = timeParts[1]?.trim();
    if (!startStr || !endStr) return;

    const startSec = srtTimeToSeconds(startStr);
    const endSec = srtTimeToSeconds(endStr);
    if (isNaN(startSec) || isNaN(endSec) || startSec >= endSec) return;

    // Get text (all lines after timing line)
    let text = lines
      .slice(timingLineIndex + 1)
      .join('\n')
      .trim();

    // Process text based on translation marker
    if (text.includes('###TRANSLATION_MARKER###')) {
      const [_originalText, translatedText] = text.split(
        '###TRANSLATION_MARKER###'
      );

      // For English translation, only show translated text
      if (targetLanguage === 'english') {
        text = translatedText.trim();
      }
      // For other languages with showOriginalText unchecked, only show translated text
      else if (targetLanguage !== 'original' && !showOriginalText) {
        text = translatedText.trim();
      }
      // Otherwise (non-English with showOriginalText checked), keep both with a line break
      else {
        text = text.replace(/###TRANSLATION_MARKER###/g, '\n');
      }
    }

    segments.push({ index, start: startSec, end: endSec, text });
  });

  return segments;
}

export function srtTimeToSeconds(timeStr: string): number {
  try {
    const parts = timeStr.split(',');
    if (parts.length !== 2) return NaN;

    const [hms, msStr] = parts;
    const [hh, mm, ss] = hms.split(':');

    if (!hh || !mm || !ss || !msStr) return NaN;

    const hours = parseInt(hh, 10);
    const minutes = parseInt(mm, 10);
    const seconds = parseInt(ss, 10);
    const milliseconds = parseInt(msStr, 10);

    if (
      isNaN(hours) ||
      isNaN(minutes) ||
      isNaN(seconds) ||
      isNaN(milliseconds)
    ) {
      return NaN;
    }

    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  } catch (e) {
    console.error('Error parsing SRT time:', e);
    return NaN;
  }
}

export interface SrtSegment {
  index: number;
  start: number;
  end: number;
  text: string;
  originalText?: string;
}

export const srtTimeToSeconds = (timeString: string): number => {
  const parts = timeString.split(":");
  if (parts.length !== 3) return 0;
  const [hours, minutes, secondsPart] = parts;
  const [seconds, milliseconds] = secondsPart.replace(",", ".").split(".");
  return (
    parseInt(hours) * 3600 +
    parseInt(minutes) * 60 +
    parseInt(seconds) +
    (milliseconds ? parseInt(milliseconds) / 1000 : 0)
  );
};

export const validateSubtitleTimings = (
  subtitles: SrtSegment[]
): SrtSegment[] => {
  if (!subtitles || subtitles.length === 0) return [];
  return subtitles.map((subtitle) => {
    const fixed = { ...subtitle };
    if (fixed.start < 0) fixed.start = 0;
    if (fixed.end <= fixed.start) fixed.end = fixed.start + 0.5;
    return fixed;
  });
};

export const secondsToSrtTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};

export const parseSrt = (srtString: string): SrtSegment[] => {
  if (!srtString) return [];
  const segments: SrtSegment[] = [];
  const blocks = srtString.trim().split(/\r?\n\r?\n/);
  blocks.forEach((block) => {
    const lines = block.split(/\r?\n/);
    if (lines.length < 3) return;
    const index = parseInt(lines[0].trim(), 10);
    const timeMatch = lines[1].match(
      /(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)/
    );
    if (!timeMatch) return;
    const startTime = srtTimeToSeconds(timeMatch[1]);
    const endTime = srtTimeToSeconds(timeMatch[2]);
    const text = lines.slice(2).join("\n");
    segments.push({ index, start: startTime, end: endTime, text });
  });
  return segments;
};

export const generateSrtContent = (segments: SrtSegment[]): string => {
  return segments
    .map((segment, i) => {
      const index = i + 1;
      const startTime = secondsToSrtTime(segment.start);
      const endTime = secondsToSrtTime(segment.end);
      return `${index}\n${startTime} --> ${endTime}\n${segment.text}`;
    })
    .join("\n\n");
};

import log from 'electron-log';
import { parseSrt } from '../../../shared/helpers/index.js';
import { cueText } from '../../../shared/helpers/index.js';
import type { SrtSegment } from '@shared-types/app';

// Define the type locally based on cueText signature
type CueTextMode = 'original' | 'translation' | 'dual';

export function generateSubtitleEvents({
  srtContent,
  outputMode,
  videoDuration,
  operationId,
}: {
  srtContent: string;
  // Note: Input accepts 'single' for convenience, mapped internally to 'original' for cueText
  outputMode: 'dual' | 'single';
  videoDuration: number;
  operationId: string;
}): Array<{ timeMs: number; text: string }> {
  const segments: SrtSegment[] = parseSrt(srtContent);
  log.info(`[srt-parser ${operationId}] parsed ${segments.length} SRT cues`);

  const events: Array<{ timeMs: number; text: string }> = [
    { timeMs: 0, text: '' },
  ];
  const ms = (sec: number) => Math.round(sec * 1000);
  const MIN_MS = 1;

  segments.forEach(s => {
    const start = Math.max(0, ms(s.start));
    const end = Math.max(start + MIN_MS, ms(s.end));
    // Map 'single' to 'original' for cueText
    const cueOutputMode: CueTextMode =
      outputMode === 'single' ? 'original' : outputMode;
    const text = cueText(s, cueOutputMode);
    events.push({ timeMs: start, text });
    events.push({ timeMs: end, text: '' });
  });

  /* ensure trailing blank exactly at duration */
  const durationMs = ms(videoDuration);
  events.push({ timeMs: durationMs, text: '' });

  /* dedupe / sort */
  events.sort((a, b) => a.timeMs - b.timeMs);

  const uniq: typeof events = [];
  for (const e of events) {
    const prev = uniq[uniq.length - 1];
    if (!prev || e.text !== prev.text) uniq.push(e);
  }

  log.info(`[srt-parser ${operationId}] ${uniq.length} unique events`);
  return uniq;
}

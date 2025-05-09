import log from 'electron-log';
import { parseSrt, cueText } from '../../../shared/helpers/index.js';

type CueTextMode = 'original' | 'translation' | 'dual';

export function generateSubtitleEvents({
  srtContent,
  outputMode,
  videoDuration,
  operationId,
}: {
  srtContent: string;
  outputMode: 'dual' | 'single';
  videoDuration: number;
  operationId: string;
}): Array<{ timeMs: number; text: string }> {
  const ms = (sec: number) => Math.round(sec * 1000);

  interface Interval {
    start: number;
    end: number;
    text: string;
  }
  const mergedSegments: Interval[] = [];
  const parsedSrt = parseSrt(srtContent);
  log.info(
    `[srt-parser ${operationId}] parsed ${parsedSrt.length} raw SRT cues`
  );

  for (const s of parsedSrt) {
    const start = ms(s.start);
    const end = ms(s.end);
    const cueOutputMode: CueTextMode =
      outputMode === 'single' ? 'original' : outputMode;
    const text = cueText(s, cueOutputMode);

    const clampedEnd = Math.min(end, ms(videoDuration));
    if (start >= clampedEnd) {
      log.warn(
        `[srt-parser ${operationId}] Skipping segment with zero/negative duration or past video duration: ${JSON.stringify(s)}`
      );
      continue;
    }

    const last = mergedSegments.at(-1);

    if (last && last.text === text && start <= last.end) {
      last.end = Math.max(last.end, clampedEnd);
    } else {
      const adjustedStart = last && start < last.end ? last.end : start;
      if (adjustedStart < clampedEnd) {
        mergedSegments.push({ start: adjustedStart, end: clampedEnd, text });
      } else {
        log.warn(
          `[srt-parser ${operationId}] Skipping segment after start time adjustment due to overlap: ${JSON.stringify(s)}`
        );
      }
    }
  }
  log.info(
    `[srt-parser ${operationId}] created ${mergedSegments.length} merged segments`
  );

  const events: Array<{ timeMs: number; text: string }> = [
    { timeMs: 0, text: '' },
  ];
  mergedSegments.forEach(seg => {
    if (seg.start === 0) {
      events[0].text = seg.text;
    } else {
      events.push({ timeMs: seg.start, text: seg.text });
    }
    events.push({ timeMs: seg.end, text: '' });
  });

  const durationMs = ms(videoDuration);
  events.push({ timeMs: durationMs, text: '' });

  events.sort((a, b) => a.timeMs - b.timeMs);
  const final: typeof events = [];
  for (const e of events) {
    if (
      !final.length ||
      final.at(-1)!.timeMs !== e.timeMs ||
      final.at(-1)!.text !== e.text
    ) {
      final.push(e);
    }
  }

  log.info(
    `[srt-parser ${operationId}] ${final.length} unique events generated`
  );
  return final;
}

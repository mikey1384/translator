import log from 'electron-log';
import type {
  SrtSegment,
  SubtitleDisplayMode,
  SubtitleRenderEvent,
  SubtitleRenderState,
} from '@shared-types/app';
import { cueText } from '../../../shared/helpers/index.js';
import { buildCueTimeline } from '../../../shared/helpers/subtitle-cue-timeline.js';

const ms = (sec: number) => Math.round(sec * 1000);

function createPlainState(text: string): SubtitleRenderState {
  return { mode: 'plain', text };
}

function getRenderStateKey(state: SubtitleRenderState): string {
  if (state.mode === 'editorial') return JSON.stringify(state);
  return `plain:${state.text}`;
}

function finalizeRenderEvents(
  events: SubtitleRenderEvent[],
  videoDuration: number,
  operationId: string,
  logLabel: string
): SubtitleRenderEvent[] {
  events.push({ timeMs: ms(videoDuration), state: createPlainState('') });
  events.sort((a, b) => a.timeMs - b.timeMs);

  const final: SubtitleRenderEvent[] = [];
  for (const event of events) {
    const previous = final.at(-1);
    if (
      !previous ||
      previous.timeMs !== event.timeMs ||
      getRenderStateKey(previous.state) !== getRenderStateKey(event.state)
    ) {
      final.push(event);
    }
  }

  log.info(`[srt-parser ${operationId}] ${final.length} unique ${logLabel}`);
  return final;
}

/**
 * The burned-in subtitle states, using exactly the cue times the player uses
 * (no stretching or gap filling) and the player's overlap rule.
 */
export function generateSubtitleEvents({
  segments,
  outputMode,
  videoDuration,
  operationId,
}: {
  segments: SrtSegment[];
  outputMode: SubtitleDisplayMode;
  videoDuration: number;
  operationId: string;
}): SubtitleRenderEvent[] {
  log.info(
    `[srt-parser ${operationId}] received ${segments.length} subtitle segments`
  );

  const cues = segments.map(segment => ({
    start: ms(segment.start),
    end: ms(segment.end),
  }));
  const spans = buildCueTimeline(cues, ms(videoDuration));

  const events: SubtitleRenderEvent[] = [
    { timeMs: 0, state: createPlainState('') },
  ];
  let previousEnd = -1;
  let previousText = '';
  for (const span of spans) {
    const text = cueText(segments[span.cueIndex], outputMode);
    // Back-to-back cues with the same text read as one line.
    if (span.start === previousEnd && text === previousText) {
      events.pop();
    } else if (span.start === 0) {
      events[0].state = createPlainState(text);
    } else {
      events.push({ timeMs: span.start, state: createPlainState(text) });
    }
    events.push({ timeMs: span.end, state: createPlainState('') });
    previousEnd = span.end;
    previousText = text;
  }

  return finalizeRenderEvents(
    events,
    videoDuration,
    operationId,
    'subtitle events generated'
  );
}

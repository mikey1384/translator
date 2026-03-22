import log from 'electron-log';
import type {
  SrtSegment,
  SubtitleDisplayMode,
  SubtitleRenderEvent,
  SubtitleRenderPart,
  SubtitleRenderState,
  TimedSubtitlePartState,
} from '@shared-types/app';
import { cueText } from '../../../shared/helpers/index.js';

const ms = (sec: number) => Math.round(sec * 1000);

function createPlainState(text: string): SubtitleRenderState {
  return { mode: 'plain', text };
}

function getRenderStateKey(state: SubtitleRenderState): string {
  if (state.mode === 'plain') {
    return `plain:${state.text}`;
  }

  return `timed:${state.parts
    .map(part =>
      part.kind === 'whitespace'
        ? `space:${part.text}`
        : `word:${part.state}:${part.text}`
    )
    .join('|')}`;
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
  interface Interval {
    start: number;
    end: number;
    text: string;
  }

  const mergedSegments: Interval[] = [];
  log.info(
    `[srt-parser ${operationId}] received ${segments.length} subtitle segments`
  );

  for (const segment of segments) {
    const start = ms(segment.start);
    const end = ms(segment.end);
    const text = cueText(segment, outputMode);
    const clampedEnd = Math.min(end, ms(videoDuration));

    if (start >= clampedEnd) {
      log.warn(
        `[srt-parser ${operationId}] Skipping segment with zero/negative duration or past video duration: ${JSON.stringify(segment)}`
      );
      continue;
    }

    const last = mergedSegments.at(-1);
    if (last && last.text === text && start <= last.end) {
      last.end = Math.max(last.end, clampedEnd);
      continue;
    }

    const adjustedStart = last && start < last.end ? last.end : start;
    if (adjustedStart < clampedEnd) {
      mergedSegments.push({ start: adjustedStart, end: clampedEnd, text });
      continue;
    }

    log.warn(
      `[srt-parser ${operationId}] Skipping segment after start time adjustment due to overlap: ${JSON.stringify(segment)}`
    );
  }

  log.info(
    `[srt-parser ${operationId}] created ${mergedSegments.length} merged segments`
  );

  const events: SubtitleRenderEvent[] = [
    { timeMs: 0, state: createPlainState('') },
  ];

  for (const segment of mergedSegments) {
    const state = createPlainState(segment.text);
    if (segment.start === 0) {
      events[0].state = state;
    } else {
      events.push({ timeMs: segment.start, state });
    }
    events.push({ timeMs: segment.end, state: createPlainState('') });
  }

  return finalizeRenderEvents(
    events,
    videoDuration,
    operationId,
    'subtitle events generated'
  );
}

type TimedWordLayout =
  | {
      kind: 'whitespace';
      text: string;
    }
  | {
      kind: 'word';
      text: string;
      wordIndex: number;
    };

type TimedWordMatch = {
  wordIndex: number;
  text: string;
  start: number;
  end: number;
};

const WORDISH_TEXT_RX = /[\p{L}\p{N}\p{M}]/u;
const WORDISH_RUN_RX = /[\p{L}\p{N}\p{M}]+(?:['’\-‑–—][\p{L}\p{N}\p{M}]+)*/gu;

function containsRenderableWordText(text: string): boolean {
  return WORDISH_TEXT_RX.test(text);
}

function buildTimedText(layout: TimedWordLayout[]): string {
  return layout.map(part => part.text).join('');
}

function removeEmptyWrapperPairs(text: string): string {
  let current = text;
  let previous = '';

  while (current !== previous) {
    previous = current;
    current = current
      .replace(/\(\s*\)/gu, '')
      .replace(/\[\s*\]/gu, '')
      .replace(/\{\s*\}/gu, '')
      .replace(/"\s*"/gu, '')
      .replace(/'\s*'/gu, '')
      .replace(/“\s*”/gu, '')
      .replace(/‘\s*’/gu, '')
      .replace(/«\s*»/gu, '')
      .replace(/「\s*」/gu, '')
      .replace(/『\s*』/gu, '');
  }

  return current;
}

function synthesizeClippedGapText(
  gapText: string,
  position: 'leading' | 'between' | 'trailing'
): string {
  if (!gapText) {
    return '';
  }

  let text = gapText.replace(WORDISH_RUN_RX, '');
  text = removeEmptyWrapperPairs(text);
  text = text.replace(/([,;:])\s+(?=[.?!…])/gu, '');
  text = text.replace(/\s*([—–-])\s*\1+\s*/gu, ' $1 ');
  text = text.replace(/[^\S\r\n]+/gu, ' ');
  text = text.replace(/ *\n */gu, '\n');
  text = text.replace(/([([{«“‘])\s+/gu, '$1');
  text = text.replace(/[ \t]+([,.;:!?…)\]}»”’،，。！？؛：、])/gu, '$1');
  text = text.replace(/\n{3,}/gu, '\n\n');

  if (position === 'leading') {
    text = text.replace(/^[\t ]+/u, '');
    text = text.replace(/^[,;:!?…،，。！？؛：、]+[ \t]*/u, '');
    text = text.replace(/^[\t ]+/u, '');
  } else if (position === 'trailing') {
    text = text.replace(/[ \t]+$/u, '');
    text = text.replace(/[ \t]*[,;:،，؛：、-]+$/u, '');
  }

  text = text.replace(/[^\S\r\n]+/gu, ' ');
  text = text.replace(/ *\n */gu, '\n');

  if (text.includes('\n')) {
    return text;
  }

  if (/[^\s]/u.test(text)) {
    return text;
  }

  return position === 'between' && /\s/u.test(gapText) ? ' ' : '';
}

function buildSyntheticTimedWordLayout(args: {
  sourceText: string;
  matches: TimedWordMatch[];
  words: NonNullable<SrtSegment['words']>;
}): {
  layout: TimedWordLayout[];
  words: NonNullable<SrtSegment['words']>;
  text: string;
} | null {
  const { sourceText, matches, words } = args;
  if (matches.length === 0) {
    return null;
  }

  const layout: TimedWordLayout[] = [];
  const leadingGap = synthesizeClippedGapText(
    sourceText.slice(0, matches[0].start),
    'leading'
  );
  if (leadingGap) {
    layout.push({ kind: 'whitespace', text: leadingGap });
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (index > 0) {
      const previous = matches[index - 1];
      const separator = synthesizeClippedGapText(
        sourceText.slice(previous.end, match.start),
        'between'
      );
      if (separator) {
        layout.push({ kind: 'whitespace', text: separator });
      }
    }

    layout.push({
      kind: 'word',
      text: match.text,
      wordIndex: match.wordIndex,
    });
  }

  const trailingGap = synthesizeClippedGapText(
    sourceText.slice(matches.at(-1)!.end),
    'trailing'
  );
  if (trailingGap) {
    layout.push({ kind: 'whitespace', text: trailingGap });
  }

  return {
    layout,
    words,
    text: buildTimedText(layout),
  };
}

function buildTimedWordLayout(segment: SrtSegment): {
  layout: TimedWordLayout[];
  words: NonNullable<SrtSegment['words']>;
  text: string;
} | null {
  if (!Array.isArray(segment.words) || segment.words.length === 0) {
    return null;
  }

  const sourceText = segment.original ?? '';
  if (!sourceText) {
    return null;
  }

  const lowerSourceText = sourceText.toLocaleLowerCase();
  const matches: TimedWordMatch[] = [];
  let cursor = 0;

  for (let wordIndex = 0; wordIndex < segment.words.length; wordIndex += 1) {
    const word = segment.words[wordIndex];
    const token = String(word.word ?? '').trim();
    if (!token) {
      return null;
    }

    let matchIndex = sourceText.indexOf(token, cursor);
    if (matchIndex === -1) {
      matchIndex = lowerSourceText.indexOf(token.toLocaleLowerCase(), cursor);
    }
    if (matchIndex === -1) {
      return null;
    }

    matches.push({
      wordIndex,
      text: sourceText.slice(matchIndex, matchIndex + token.length),
      start: matchIndex,
      end: matchIndex + token.length,
    });
    cursor = matchIndex + token.length;
  }

  const layout: TimedWordLayout[] = [];
  const leadingGap = sourceText.slice(0, matches[0]!.start);
  if (containsRenderableWordText(leadingGap)) {
    return buildSyntheticTimedWordLayout({
      sourceText,
      matches,
      words: segment.words,
    });
  }
  if (leadingGap && !containsRenderableWordText(leadingGap)) {
    layout.push({
      kind: 'whitespace',
      text: leadingGap,
    });
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    if (index > 0) {
      const previous = matches[index - 1]!;
      const gap = sourceText.slice(previous.end, match.start);
      if (containsRenderableWordText(gap)) {
        return buildSyntheticTimedWordLayout({
          sourceText,
          matches,
          words: segment.words,
        });
      }
      if (gap) {
        layout.push({
          kind: 'whitespace',
          text: gap,
        });
      }
    }

    layout.push({
      kind: 'word',
      text: match.text,
      wordIndex: match.wordIndex,
    });
  }

  const trailingGap = sourceText.slice(matches.at(-1)!.end);
  if (containsRenderableWordText(trailingGap)) {
    return buildSyntheticTimedWordLayout({
      sourceText,
      matches,
      words: segment.words,
    });
  }
  if (trailingGap && !containsRenderableWordText(trailingGap)) {
    layout.push({
      kind: 'whitespace',
      text: trailingGap,
    });
  }

  return {
    layout,
    words: segment.words,
    text: buildTimedText(layout),
  };
}

function buildTimedParts(
  layout: TimedWordLayout[],
  wordStates: TimedSubtitlePartState[]
): SubtitleRenderPart[] {
  return layout.map(part => {
    if (part.kind === 'whitespace') {
      return part;
    }

    return {
      kind: 'word',
      text: part.text,
      state: wordStates[part.wordIndex] ?? 'upcoming',
    };
  });
}

function createTimedState(
  text: string,
  wordStates: TimedSubtitlePartState[],
  layout: TimedWordLayout[]
): SubtitleRenderState {
  return {
    mode: 'timed',
    text,
    parts: buildTimedParts(layout, wordStates),
  };
}

type TimedWordBoundaryAction = {
  timeMs: number;
  type: 'start' | 'end';
  wordIndex: number;
};

export function generateTimedOriginalSubtitleEvents({
  segments,
  videoDuration,
  operationId,
}: {
  segments: SrtSegment[];
  videoDuration: number;
  operationId: string;
}): SubtitleRenderEvent[] {
  const events: SubtitleRenderEvent[] = [
    { timeMs: 0, state: createPlainState('') },
  ];
  let timedSegments = 0;
  let fallbackSegments = 0;

  for (const segment of segments) {
    const start = ms(segment.start);
    const end = Math.min(ms(segment.end), ms(videoDuration));
    if (start >= end) {
      continue;
    }

    const timedLayout = buildTimedWordLayout(segment);
    if (!timedLayout) {
      fallbackSegments += 1;
      const text = cueText(segment, 'original');
      const state = createPlainState(text);
      if (start === 0) {
        events[0].state = state;
      } else {
        events.push({ timeMs: start, state });
      }
      events.push({ timeMs: end, state: createPlainState('') });
      continue;
    }

    const { layout, words, text } = timedLayout;
    const boundaryActions: TimedWordBoundaryAction[] = [];

    for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
      const word = words[wordIndex];
      const absWordStart = Math.min(
        end,
        Math.max(start, start + ms(word.start))
      );
      const absWordEnd = Math.min(
        end,
        Math.max(absWordStart, start + ms(word.end))
      );

      if (absWordStart < end) {
        boundaryActions.push({
          timeMs: absWordStart,
          type: 'start',
          wordIndex,
        });
      }

      if (absWordEnd < end) {
        boundaryActions.push({
          timeMs: absWordEnd,
          type: 'end',
          wordIndex,
        });
      }
    }

    if (!boundaryActions.length) {
      fallbackSegments += 1;
      const state = createPlainState(cueText(segment, 'original'));
      if (start === 0) {
        events[0].state = state;
      } else {
        events.push({ timeMs: start, state });
      }
    } else {
      const wordStates = words.map(() => 'upcoming' as TimedSubtitlePartState);
      const sortedActions = boundaryActions.sort((left, right) => {
        if (left.timeMs !== right.timeMs) {
          return left.timeMs - right.timeMs;
        }
        if (left.type !== right.type) {
          return left.type === 'end' ? -1 : 1;
        }
        return left.wordIndex - right.wordIndex;
      });

      if (sortedActions[0].timeMs > start) {
        const state = createTimedState(text, wordStates, layout);
        if (start === 0 && events[0].state.text === '') {
          events[0].state = state;
        } else {
          events.push({ timeMs: start, state });
        }
      }

      let actionIndex = 0;
      while (actionIndex < sortedActions.length) {
        const boundaryTimeMs = sortedActions[actionIndex].timeMs;

        while (
          actionIndex < sortedActions.length &&
          sortedActions[actionIndex].timeMs === boundaryTimeMs
        ) {
          const action = sortedActions[actionIndex];
          wordStates[action.wordIndex] =
            action.type === 'start' ? 'active' : 'spoken';
          actionIndex += 1;
        }

        const state = createTimedState(text, wordStates, layout);
        if (boundaryTimeMs === 0 && events[0].state.text === '') {
          events[0].state = state;
        } else {
          events.push({
            timeMs: boundaryTimeMs,
            state,
          });
        }
      }

      timedSegments += 1;
    }

    events.push({ timeMs: end, state: createPlainState('') });
  }

  log.info(
    `[srt-parser ${operationId}] timed original render enabled for ${timedSegments} segments, ${fallbackSegments} fallback`
  );

  return finalizeRenderEvents(
    events,
    videoDuration,
    operationId,
    'timed subtitle events generated'
  );
}

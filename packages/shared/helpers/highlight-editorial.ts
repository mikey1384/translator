import type {
  HighlightEditorialPlan,
  SubtitleRenderEvent,
  SrtSegment,
} from '@shared-types/app';

/** Times are relative to the selected highlight, never to the whole source. */
export function validateHighlightEditorialPlan(
  input: unknown,
  duration: number
): HighlightEditorialPlan {
  const raw = input as HighlightEditorialPlan;
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    throw new Error('A valid highlight edit and duration are required.');
  if (!Array.isArray(raw.shots) || !raw.shots.length || raw.shots.length > 40)
    throw new Error(
      'An edit needs 1–40 shots covering the complete highlight.'
    );
  let previousEnd = 0;
  const interval = (start: number, end: number) => {
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > duration + 0.001
    )
      throw new Error('Edit timings must stay inside the selected highlight.');
  };
  const shots = raw.shots.map(shot => {
    interval(shot.start, shot.end);
    if (Math.abs(shot.start - previousEnd) > 0.001)
      throw new Error(
        'Shots must cover the highlight in order, without gaps or overlaps.'
      );
    if (
      ![shot.centerX, shot.centerY].every(
        n => Number.isFinite(n) && n >= 0 && n <= 1
      ) ||
      !Number.isFinite(shot.zoom) ||
      shot.zoom < 1 ||
      shot.zoom > 2.5
    )
      throw new Error('Shot centers must be 0–1 and zoom must be 1–2.5.');
    previousEnd = shot.end;
    return {
      start: shot.start,
      end: shot.end,
      centerX: shot.centerX,
      centerY: shot.centerY,
      zoom: shot.zoom,
    };
  });
  if (Math.abs(previousEnd - duration) > 0.001)
    throw new Error('The final shot must end at the highlight boundary.');
  if (
    !Array.isArray(raw.captions) ||
    !raw.captions.length ||
    raw.captions.length > 160
  )
    throw new Error('An edit needs 1–160 caption phrases.');
  previousEnd = 0;
  const captions = raw.captions.map(caption => {
    interval(caption.start, caption.end);
    if (caption.start < previousEnd - 0.001)
      throw new Error('Caption phrases cannot overlap or run out of order.');
    const text = typeof caption.text === 'string' ? caption.text.trim() : '';
    const emphasis =
      typeof caption.emphasis === 'string' ? caption.emphasis.trim() : '';
    if (!text || text.length > 100 || text.split('\n').length > 2)
      throw new Error(
        'Keep each caption phrase within two short lines (100 characters).'
      );
    if (emphasis && !text.includes(emphasis))
      throw new Error('Emphasis must be an exact phrase in its caption.');
    previousEnd = caption.end;
    return {
      start: caption.start,
      end: caption.end,
      text,
      ...(emphasis ? { emphasis } : {}),
    };
  });
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (label.length > 60)
    throw new Error('Keep the speaker/topic label under 60 characters.');
  return { shots, captions, ...(label ? { label } : {}) };
}

export function editorialCrop(
  shot: HighlightEditorialPlan['shots'][number],
  width: number,
  height: number
) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 2 ||
    height < 2
  )
    throw new Error('The source dimensions must be known before reframing.');
  const baseHeight = Math.min(height, (width * 16) / 9);
  const cropHeight = Math.max(2, Math.floor(baseHeight / shot.zoom / 2) * 2);
  const cropWidth = Math.max(2, Math.floor((cropHeight * 9) / 16 / 2) * 2);
  return {
    width: cropWidth,
    height: cropHeight,
    x:
      Math.round(
        Math.max(
          0,
          Math.min(width - cropWidth, shot.centerX * width - cropWidth / 2)
        ) / 2
      ) * 2,
    y:
      Math.round(
        Math.max(
          0,
          Math.min(height - cropHeight, shot.centerY * height - cropHeight / 2)
        ) / 2
      ) * 2,
  };
}

/** Split only at intentional edit/source cuts; never pan across another speaker. */
export function buildEditorialReframeGraph(
  plan: HighlightEditorialPlan,
  width: number,
  height: number,
  input: string,
  output: string,
  prefix: string
): string {
  const labels = plan.shots.map((_, i) => `${prefix}input${i}`);
  const filters = [
    `[${input}]split=${labels.length}${labels.map(l => `[${l}]`).join('')}`,
  ];
  plan.shots.forEach((shot, i) => {
    const crop = editorialCrop(shot, width, height);
    filters.push(
      `[${labels[i]}]trim=start=${shot.start}:end=${shot.end},setpts=PTS-STARTPTS,crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=1080:1920:flags=lanczos,setsar=1[${prefix}shot${i}]`
    );
  });
  filters.push(
    `${plan.shots.map((_, i) => `[${prefix}shot${i}]`).join('')}concat=n=${plan.shots.length}:v=1:a=0[${output}]`
  );
  return filters.join(';');
}

export function editorialCaptionEvents(
  plan: HighlightEditorialPlan,
  duration: number
): SubtitleRenderEvent[] {
  const empty = {
    mode: 'editorial' as const,
    text: '',
    label: plan.label,
    scale: 1,
  };
  const events: SubtitleRenderEvent[] = [{ timeMs: 0, state: empty }];
  for (const caption of plan.captions) {
    // A short restrained entrance, sampled deterministically into the overlay.
    for (const [offset, scale] of [
      [0, 0.96],
      [0.04, 1.025],
      [0.08, 1.008],
      [0.12, 1],
    ] as const) {
      if (caption.start + offset >= caption.end) continue;
      events.push({
        timeMs: Math.round((caption.start + offset) * 1000),
        state: {
          mode: 'editorial',
          text: caption.text,
          emphasis: caption.emphasis,
          label: plan.label,
          scale,
        },
      });
    }
    events.push({ timeMs: Math.round(caption.end * 1000), state: empty });
  }
  events.push({
    timeMs: Math.round(duration * 1000),
    state: { mode: 'plain', text: '' },
  });
  // Last writer wins at shared boundaries: never flicker blank between phrases.
  return [...new Map(events.map(e => [e.timeMs, e])).values()].sort(
    (a, b) => a.timeMs - b.timeMs
  );
}

export function editorialSourceSignature(
  cues: readonly SrtSegment[],
  start: number,
  end: number
): string {
  return JSON.stringify(
    cues
      .filter(c => c.end > start && c.start < end)
      .map(c => [c.start, c.end, c.original, c.translation ?? ''])
  );
}

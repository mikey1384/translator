// Shared by the persistent job store, editor and PNG render boundary.
// All times are seconds. SRT's millisecond rounding is the only tolerance.
export function subtitleTimingIssues(segments, mediaDurationSeconds) {
  const issues = [];
  const duration = Number(mediaDurationSeconds);
  let previous = null;
  for (const [index, cue] of segments.entries()) {
    const { start, end } = cue;
    let code = null;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    ) {
      code = 'invalid_timing';
    } else if (previous && start < previous.end - 0.001) {
      code = 'timestamp_overlap';
    }
    if (code)
      issues.push({ code, cue_id: cue.id, index: index + 1, start, end });
    if (Number.isFinite(duration) && duration > 0 && end > duration + 0.001) {
      issues.push({
        code: 'subtitle_exceeds_media_duration',
        cue_id: cue.id,
        index: index + 1,
        start,
        end,
        media_duration_seconds: duration,
      });
    }
    previous = cue;
  }
  return issues;
}

/** Explicit, reversible repairs: never move a speech start to fill a gap. */
export function repairSubtitleTimings(
  segments,
  {
    mediaDurationSeconds,
    trimToMedia = false,
    joinGapsUpToSeconds = 0,
    preserveGapAfterIds = [],
  } = {}
) {
  if (
    !Number.isFinite(joinGapsUpToSeconds) ||
    joinGapsUpToSeconds < 0 ||
    joinGapsUpToSeconds > 0.5
  ) {
    throw new Error(
      'Gap joining must be between 0 and 0.5 seconds; longer pauses require an explicit cue edit.'
    );
  }
  const duration = Number(mediaDurationSeconds);
  if (trimToMedia && !(Number.isFinite(duration) && duration > 0)) {
    throw new Error(
      'Probe the actual media duration before trimming subtitles.'
    );
  }
  const changes = [];
  const cues = [];
  for (const segment of segments) {
    const cue = structuredClone(segment);
    if (trimToMedia && cue.start >= duration) {
      changes.push({
        cue_id: cue.id,
        action: 'remove_after_media',
        before: { start: cue.start, end: cue.end },
      });
      continue;
    }
    if (trimToMedia && cue.end > duration) {
      changes.push({
        cue_id: cue.id,
        action: 'trim_end',
        before: cue.end,
        after: duration,
      });
      cue.end = duration;
    }
    cues.push(cue);
  }
  const preserve = new Set(preserveGapAfterIds);
  for (let index = 0; index + 1 < cues.length; index += 1) {
    const cue = cues[index];
    const next = cues[index + 1];
    const gap = next.start - cue.end;
    if (
      gap > 0.001 &&
      gap <= joinGapsUpToSeconds + 1e-9 &&
      !preserve.has(cue.id) &&
      !(cue.source_ids || cue.sourceCueIds || []).some(id => preserve.has(id))
    ) {
      changes.push({
        cue_id: cue.id,
        action: 'extend_end_across_short_gap',
        before: cue.end,
        after: next.start,
      });
      cue.end = next.start;
    }
  }
  return { segments: cues, changes };
}

export function normalizeSubtitleRevision(cues, rawSegments) {
  if (!Array.isArray(cues) || !cues.length || cues.length > 100_000) {
    throw new Error('A reviewed revision must contain 1–100,000 cues.');
  }
  const rawIds = new Set(rawSegments.map(cue => cue.id));
  const ids = new Set();
  const referenced = new Set();
  let characters = 0;
  const segments = cues.map((cue, index) => {
    const id = String(cue?.id || '').trim();
    if (
      !id ||
      id.length > 200 ||
      id === 'prototype' ||
      Object.hasOwn(Object.prototype, id) ||
      /[\u0000-\u001f\u007f]/.test(id) ||
      ids.has(id)
    ) {
      throw new Error(
        'Reviewed cue IDs must be unique, printable, non-reserved and at most 200 characters.'
      );
    }
    ids.add(id);
    const sourceIds =
      cue.source_ids ?? cue.sourceCueIds ?? (rawIds.has(id) ? [id] : null);
    if (
      !Array.isArray(sourceIds) ||
      !sourceIds.length ||
      new Set(sourceIds).size !== sourceIds.length ||
      sourceIds.some(sourceId => !rawIds.has(sourceId))
    ) {
      throw new Error(
        `Reviewed cue ${id} must name its original source_ids; unknown provenance is not accepted.`
      );
    }
    sourceIds.forEach(sourceId => referenced.add(sourceId));
    const source = cue.source ?? cue.original;
    const translation = cue.translation ?? '';
    if (
      typeof source !== 'string' ||
      !source.trim() ||
      typeof translation !== 'string' ||
      source.length > 10000 ||
      translation.length > 10000
    ) {
      throw new Error(
        `Reviewed cue ${id} has invalid or oversized subtitle text.`
      );
    }
    characters += source.length + translation.length;
    if (characters > 32 * 1024 * 1024)
      throw new Error('Reviewed subtitle text exceeds 32 MiB.');
    return {
      id,
      index: index + 1,
      start: cue.start,
      end: cue.end,
      start_ms: Math.round(cue.start * 1000),
      end_ms: Math.round(cue.end * 1000),
      source,
      translation,
      source_ids: [...sourceIds],
      status: translation.trim() ? 'reviewed' : 'pending',
    };
  });
  return {
    segments,
    deleted_source_ids: [...rawIds].filter(id => !referenced.has(id)),
  };
}

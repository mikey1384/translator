const TIMECODE_RE =
  /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})(?:\s+.*)?$/;

function parseTimecodeMatch(match, offset) {
  const hours = Number(match[offset]);
  const minutes = Number(match[offset + 1]);
  const seconds = Number(match[offset + 2]);
  const milliseconds = Number(match[offset + 3]);
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

export function parseSrt(input) {
  const normalized = String(input || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!normalized) return [];

  const segments = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timeIndex = lines.findIndex(line => TIMECODE_RE.test(line.trim()));
    if (timeIndex === -1) continue;
    const match = lines[timeIndex].trim().match(TIMECODE_RE);
    if (!match) continue;
    const text = lines
      .slice(timeIndex + 1)
      .join('\n')
      .trim();
    if (!text) continue;
    segments.push({
      id: `cue-${segments.length + 1}`,
      index: segments.length + 1,
      start: parseTimecodeMatch(match, 1),
      end: parseTimecodeMatch(match, 5),
      source: text,
      translation: '',
      status: 'pending',
      revisionCount: 0,
    });
  }
  return segments;
}

export function formatSrtTime(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const wholeMilliseconds = Math.round(safe * 1000);
  const hours = Math.floor(wholeMilliseconds / 3_600_000);
  const minutes = Math.floor((wholeMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((wholeMilliseconds % 60_000) / 1000);
  const milliseconds = wholeMilliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

export function buildSrt(segments, mode = 'dual') {
  if (!['source', 'translation', 'dual'].includes(mode)) {
    throw new Error(`Unsupported SRT export mode: ${mode}`);
  }
  return segments
    .map((segment, offset) => {
      const source = String(segment.source || '').trim();
      const translation = String(segment.translation || '').trim();
      let text = source;
      if (mode === 'translation') text = translation || source;
      if (mode === 'dual') text = translation ? `${source}\n${translation}` : source;
      return `${offset + 1}\n${formatSrtTime(segment.start)} --> ${formatSrtTime(segment.end)}\n${text}`;
    })
    .join('\n\n')
    .concat('\n');
}

export function mergeTranslationSrt(sourceSegments, translationSegments) {
  if (sourceSegments.length !== translationSegments.length) {
    throw new Error(
      `Source and translation SRT cue counts differ (${sourceSegments.length} vs ${translationSegments.length}).`
    );
  }
  return sourceSegments.map((segment, index) => {
    const translated = translationSegments[index];
    const startDelta = Math.abs(segment.start - translated.start);
    const endDelta = Math.abs(segment.end - translated.end);
    if (startDelta > 0.1 || endDelta > 0.1) {
      throw new Error(`Cue ${index + 1} timecodes do not match.`);
    }
    return {
      ...segment,
      translation: translated.source,
      status: translated.source.trim() ? 'translated' : 'pending',
    };
  });
}

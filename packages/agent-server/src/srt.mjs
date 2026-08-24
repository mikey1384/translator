const TIMECODE_RE =
  /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})(?:\s+.*)?$/;

function parseTimecodeMatch(match, offset) {
  const hours = Number(match[offset]);
  const minutes = Number(match[offset + 1]);
  const seconds = Number(match[offset + 2]);
  const milliseconds = Number(match[offset + 3]);
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function validTimecodeComponents(match) {
  return (
    Number(match[2]) < 60 &&
    Number(match[3]) < 60 &&
    Number(match[6]) < 60 &&
    Number(match[7]) < 60
  );
}

export function parseSrtWithDiagnostics(input, { detailLimit = 20 } = {}) {
  const normalized = String(input || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!normalized) {
    return {
      segments: [],
      totalBlockCount: 0,
      invalidBlockCount: 0,
      diagnostics: [],
      diagnosticsTruncated: false,
    };
  }

  const segments = [];
  const diagnostics = [];
  let invalidBlockCount = 0;
  const blocks = normalized.split(/\n{2,}/);
  const boundedDetailLimit = Math.min(
    100,
    Math.max(0, Number.isInteger(detailLimit) ? detailLimit : 20)
  );
  const invalidate = (blockNumber, code, message) => {
    invalidBlockCount += 1;
    if (diagnostics.length < boundedDetailLimit) {
      diagnostics.push({ block: blockNumber, code, message });
    }
  };

  for (const [blockOffset, block] of blocks.entries()) {
    const lines = block.split('\n');
    const timeMatches = lines
      .map((line, index) => ({ index, match: line.trim().match(TIMECODE_RE) }))
      .filter(entry => entry.match);
    if (timeMatches.length === 0) {
      invalidate(
        blockOffset + 1,
        block.includes('-->') ? 'invalid_timecode' : 'missing_timecode',
        block.includes('-->')
          ? 'The cue has an invalid timecode line.'
          : 'The cue has no timecode line.'
      );
      continue;
    }
    const [{ index: timeIndex, match }] = timeMatches;
    let invalid = false;
    if (timeMatches.length > 1) {
      invalidate(
        blockOffset + 1,
        'multiple_timecodes',
        'The block contains multiple cue timecodes, usually because a blank cue separator is missing.'
      );
      invalid = true;
    } else if (!validTimecodeComponents(match)) {
      invalidate(
        blockOffset + 1,
        'invalid_timecode_component',
        'Minutes and seconds in an SRT timecode must be between 00 and 59.'
      );
      invalid = true;
    }
    const text = lines
      .slice(timeIndex + 1)
      .join('\n')
      .trim();
    if (!text) {
      if (!invalid) {
        invalidate(
          blockOffset + 1,
          'empty_cue_text',
          'The cue has no subtitle text.'
        );
      }
      continue;
    }
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
  return {
    segments,
    totalBlockCount: blocks.length,
    invalidBlockCount,
    diagnostics,
    diagnosticsTruncated: invalidBlockCount > diagnostics.length,
  };
}

export function parseSrt(input) {
  return parseSrtWithDiagnostics(input).segments;
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
      if (mode === 'dual')
        text = translation ? `${source}\n${translation}` : source;
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

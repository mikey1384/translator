const TERMINAL_PUNCTUATION = /[.!?。！？…][\s"'”’」』】)]*$/u;
const LATIN_WORD = /\b[A-Za-z][A-Za-z'-]{2,}\b/g;
const KOREAN_SYLLABLE = /[\uac00-\ud7af]/u;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const UNPAIRED_SURROGATE = /[\ud800-\udfff]/u;
export const DEFAULT_SUBTITLE_ISSUE_DETAIL_LIMIT = 100;
const HARD_MAX_ISSUE_DETAILS = 1000;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function segmentText(segment, mode) {
  if (mode === 'source') return String(segment?.source || '').trim();
  return String(segment?.translation || '').trim();
}

function lineLength(text) {
  return text
    .split(/\r?\n/u)
    .reduce((max, line) => Math.max(max, [...line].length), 0);
}

function normalizedDuplicateKey(text) {
  return text
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
}

function hasBrokenPunctuation(text) {
  const pairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['“', '”'],
    ['「', '」'],
    ['『', '』'],
  ];
  return pairs.some(([open, close]) => {
    let depth = 0;
    for (const character of text) {
      if (character === open) depth += 1;
      if (character === close) depth -= 1;
      if (depth < 0) return true;
    }
    return depth !== 0;
  });
}

function createGlossaryMatcher(entries) {
  if (!entries.length) return () => [];
  const nodes = [
    { transitions: new Map(), failure: 0, outputLink: 0, outputs: [] },
  ];
  for (let index = 0; index < entries.length; index += 1) {
    let state = 0;
    for (const character of entries[index][0].toLocaleLowerCase()) {
      let next = nodes[state].transitions.get(character);
      if (next === undefined) {
        next = nodes.length;
        nodes[state].transitions.set(character, next);
        nodes.push({
          transitions: new Map(),
          failure: 0,
          outputLink: 0,
          outputs: [],
        });
      }
      state = next;
    }
    nodes[state].outputs.push(index);
  }

  const queue = [];
  for (const next of nodes[0].transitions.values()) queue.push(next);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    for (const [character, next] of nodes[state].transitions) {
      queue.push(next);
      let fallback = nodes[state].failure;
      while (fallback !== 0 && !nodes[fallback].transitions.has(character)) {
        fallback = nodes[fallback].failure;
      }
      nodes[next].failure = nodes[fallback].transitions.get(character) ?? 0;
      const failure = nodes[next].failure;
      nodes[next].outputLink = nodes[failure].outputs.length
        ? failure
        : nodes[failure].outputLink;
    }
  }

  return text => {
    const matched = new Set();
    let state = 0;
    for (const character of String(text || '').toLocaleLowerCase()) {
      while (state !== 0 && !nodes[state].transitions.has(character)) {
        state = nodes[state].failure;
      }
      state = nodes[state].transitions.get(character) ?? 0;
      let outputState = state;
      while (outputState !== 0) {
        for (const index of nodes[outputState].outputs) matched.add(index);
        outputState = nodes[outputState].outputLink;
      }
      if (matched.size === entries.length) break;
    }
    return matched;
  };
}

function issue(severity, code, segment, message, details = {}) {
  return {
    severity,
    code,
    segment_id: segment?.id ?? null,
    segment_index: segment?.index ?? null,
    message,
    ...details,
  };
}

export function validateSubtitleSegments(
  segments,
  {
    mode = 'translation',
    targetLanguage = null,
    glossary = {},
    mediaDurationSeconds = null,
    maxLines = 2,
    maxCharactersPerLine = 42,
    preferredCharactersPerSecond = 20,
    hardCharactersPerSecond = 28,
    minimumDurationSeconds = 0.7,
    reportGapsLongerThanSeconds = 8,
    maxIssueDetails = DEFAULT_SUBTITLE_ISSUE_DETAIL_LIMIT,
  } = {}
) {
  if (!Array.isArray(segments))
    throw new TypeError('segments must be an array.');
  if (!['source', 'translation'].includes(mode)) {
    throw new TypeError('mode must be source or translation.');
  }

  const issueDetailLimit = Math.min(
    HARD_MAX_ISSUE_DETAILS,
    Math.max(
      0,
      Number.isSafeInteger(maxIssueDetails)
        ? maxIssueDetails
        : DEFAULT_SUBTITLE_ISSUE_DETAIL_LIMIT
    )
  );
  const errorIssues = [];
  const warningIssues = [];
  let errorCount = 0;
  let warningCount = 0;
  const errorCodeCounts = Object.create(null);
  const warningCodeCounts = Object.create(null);
  const recordIssue = item => {
    if (item.severity === 'error') {
      errorCount += 1;
      errorCodeCounts[item.code] = Number(errorCodeCounts[item.code] || 0) + 1;
      if (errorIssues.length < issueDetailLimit) errorIssues.push(item);
      return;
    }
    warningCount += 1;
    warningCodeCounts[item.code] =
      Number(warningCodeCounts[item.code] || 0) + 1;
    if (warningIssues.length < issueDetailLimit) warningIssues.push(item);
  };
  const seenText = new Map();
  const glossaryEntries = Object.entries(glossary || {}).filter(
    ([sourceTerm, translatedTerm]) => sourceTerm && translatedTerm
  );
  const matchGlossary = createGlossaryMatcher(glossaryEntries);
  const glossaryStates = glossaryEntries.map(() => ({
    hasExpected: false,
    hasMissing: false,
  }));
  let previous = null;
  let translated = 0;
  let totalCharacters = 0;

  if (segments.length === 0) {
    recordIssue({
      severity: 'error',
      code: 'empty_subtitle_document',
      segment_id: null,
      segment_index: null,
      message: 'Subtitle document contains no cues.',
    });
  }

  for (const segment of segments) {
    const start = finiteNumber(segment?.start, Number.NaN);
    const end = finiteNumber(segment?.end, Number.NaN);
    const text = segmentText(segment, mode);
    const source = String(segment?.source || '').trim();
    const translatedGlossaryText = String(segment?.translation || '').trim();
    const duration = end - start;

    if (translatedGlossaryText && glossaryEntries.length) {
      for (const glossaryIndex of matchGlossary(source)) {
        const [sourceTerm, translatedTerm] = glossaryEntries[glossaryIndex];
        if (translatedGlossaryText.includes(translatedTerm)) {
          glossaryStates[glossaryIndex].hasExpected = true;
        } else {
          glossaryStates[glossaryIndex].hasMissing = true;
          recordIssue(
            issue(
              'warning',
              'glossary_mismatch',
              segment,
              `Expected glossary translation for “${sourceTerm}”.`,
              { expected: translatedTerm }
            )
          );
        }
      }
    }

    if (!text) {
      recordIssue(
        issue(
          'error',
          mode === 'translation' ? 'missing_translation' : 'empty_cue',
          segment,
          mode === 'translation'
            ? 'Subtitle has not been translated.'
            : 'Subtitle text is empty.'
        )
      );
    } else {
      translated += 1;
      totalCharacters += [...text.replace(/\s/gu, '')].length;
    }

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    ) {
      recordIssue(
        issue(
          'error',
          'invalid_timing',
          segment,
          'Subtitle timing is invalid.',
          {
            start_seconds: Number.isFinite(start) ? start : null,
            end_seconds: Number.isFinite(end) ? end : null,
          }
        )
      );
    } else {
      if (!previous && start > reportGapsLongerThanSeconds) {
        recordIssue(
          issue(
            'warning',
            'long_initial_timestamp_gap',
            segment,
            'Long gap before the first subtitle cue.',
            { gap_seconds: Number(start.toFixed(3)) }
          )
        );
      }
      if (previous && start < previous.end - 0.001) {
        recordIssue(
          issue(
            'error',
            'timestamp_overlap',
            segment,
            'Subtitle overlaps the previous cue.',
            {
              previous_segment_id: previous.segment.id,
              overlap_seconds: Number((previous.end - start).toFixed(3)),
            }
          )
        );
      } else if (
        previous &&
        start - previous.end > reportGapsLongerThanSeconds
      ) {
        recordIssue(
          issue(
            'warning',
            'long_timestamp_gap',
            segment,
            'Long gap between subtitle cues.',
            {
              previous_segment_id: previous.segment.id,
              gap_seconds: Number((start - previous.end).toFixed(3)),
            }
          )
        );
      }
      if (duration < minimumDurationSeconds) {
        recordIssue(
          issue(
            'warning',
            'duration_too_short',
            segment,
            'Subtitle is displayed too briefly.',
            {
              duration_seconds: Number(duration.toFixed(3)),
            }
          )
        );
      }
      if (text) {
        const characters = [...text.replace(/\s/gu, '')].length;
        const cps = characters / duration;
        if (cps > hardCharactersPerSecond) {
          recordIssue(
            issue(
              'error',
              'reading_speed_excessive',
              segment,
              'Subtitle reading speed is excessive.',
              {
                characters_per_second: Number(cps.toFixed(1)),
              }
            )
          );
        } else if (cps > preferredCharactersPerSecond) {
          recordIssue(
            issue(
              'warning',
              'reading_speed_high',
              segment,
              'Subtitle reading speed is high.',
              {
                characters_per_second: Number(cps.toFixed(1)),
              }
            )
          );
        }
      }
      previous = { segment, start, end };
    }

    if (!text) continue;
    const lines = text.split(/\r?\n/u);
    if (lines.length > maxLines) {
      recordIssue(
        issue(
          'error',
          'too_many_lines',
          segment,
          `Subtitle uses more than ${maxLines} lines.`,
          {
            line_count: lines.length,
          }
        )
      );
    }
    const longestLine = lineLength(text);
    if (longestLine > maxCharactersPerLine) {
      recordIssue(
        issue(
          'warning',
          'line_too_long',
          segment,
          'Subtitle line is too long.',
          {
            longest_line_characters: longestLine,
            maximum_characters: maxCharactersPerLine,
          }
        )
      );
    }
    if (
      CONTROL_CHARACTER.test(text) ||
      UNPAIRED_SURROGATE.test(text) ||
      text.includes('\ufffd')
    ) {
      recordIssue(
        issue(
          'error',
          'broken_character_encoding',
          segment,
          'Subtitle contains a control character, unpaired surrogate, or Unicode replacement character.'
        )
      );
    }
    if (hasBrokenPunctuation(text)) {
      recordIssue(
        issue(
          'warning',
          'broken_punctuation',
          segment,
          'Subtitle contains unbalanced punctuation.'
        )
      );
    }

    const duplicateKey = normalizedDuplicateKey(text);
    const previousDuplicate = duplicateKey ? seenText.get(duplicateKey) : null;
    if (previousDuplicate && duplicateKey.length >= 8) {
      recordIssue(
        issue(
          'warning',
          'duplicate_subtitle',
          segment,
          'Subtitle duplicates an earlier cue.',
          {
            duplicate_of_segment_id: previousDuplicate,
          }
        )
      );
    } else if (duplicateKey) {
      seenText.set(duplicateKey, segment.id);
    }

    if (/korean/i.test(String(targetLanguage || ''))) {
      const latinWords = text.match(LATIN_WORD) || [];
      const sourceLatinWords = new Set(
        (source.match(LATIN_WORD) || []).map(word => word.toLocaleLowerCase())
      );
      const suspicious = latinWords.filter(
        word =>
          sourceLatinWords.has(word.toLocaleLowerCase()) && word.length > 3
      );
      if (suspicious.length >= 3 && !KOREAN_SYLLABLE.test(text)) {
        recordIssue(
          issue(
            'warning',
            'suspicious_untranslated_text',
            segment,
            'Cue appears to remain untranslated English.',
            {
              words: suspicious.slice(0, 8),
            }
          )
        );
      }
    }
  }

  for (let index = 0; index < glossaryEntries.length; index += 1) {
    const [sourceTerm, translatedTerm] = glossaryEntries[index];
    if (glossaryStates[index].hasMissing && glossaryStates[index].hasExpected) {
      recordIssue({
        severity: 'warning',
        code: 'inconsistent_name',
        segment_id: null,
        segment_index: null,
        message: `Recurring term “${sourceTerm}” is translated inconsistently.`,
        expected: translatedTerm,
      });
    }
  }

  const lastEnd = segments.reduce(
    (max, segment) => Math.max(max, finiteNumber(segment?.end, 0)),
    0
  );
  const mediaDuration = Number(mediaDurationSeconds);
  if (Number.isFinite(mediaDuration) && mediaDuration > 0) {
    if (lastEnd - mediaDuration > 2) {
      recordIssue({
        severity: 'error',
        code: 'subtitle_exceeds_media_duration',
        segment_id: null,
        segment_index: null,
        message: 'Subtitle cues extend beyond the planned media duration.',
        subtitle_end_seconds: Number(lastEnd.toFixed(3)),
        media_duration_seconds: Number(mediaDuration.toFixed(3)),
        delta_seconds: Number((lastEnd - mediaDuration).toFixed(3)),
      });
    } else if (mediaDuration - lastEnd > reportGapsLongerThanSeconds) {
      recordIssue({
        severity: 'warning',
        code: 'long_final_timestamp_gap',
        segment_id: null,
        segment_index: null,
        message: 'Long gap after the final subtitle cue.',
        subtitle_end_seconds: Number(lastEnd.toFixed(3)),
        media_duration_seconds: Number(mediaDuration.toFixed(3)),
        gap_seconds: Number((mediaDuration - lastEnd).toFixed(3)),
      });
    }
  }

  const issues = [
    ...errorIssues,
    ...warningIssues.slice(
      0,
      Math.max(0, issueDetailLimit - errorIssues.length)
    ),
  ];
  const totalIssueCount = errorCount + warningCount;
  return {
    passed: errorCount === 0,
    cue_count: segments.length,
    translated_cue_count: mode === 'translation' ? translated : null,
    completion_percent:
      mode === 'translation' && segments.length
        ? Math.round((translated / segments.length) * 100)
        : null,
    total_characters: totalCharacters,
    error_count: errorCount,
    warning_count: warningCount,
    error_code_counts: errorCodeCounts,
    warning_code_counts: warningCodeCounts,
    total_issue_count: totalIssueCount,
    issue_detail_limit: issueDetailLimit,
    issues_truncated: issues.length < totalIssueCount,
    omitted_issue_count: totalIssueCount - issues.length,
    issues,
  };
}

export function isSemanticBoundary(current, next) {
  if (!current) return false;
  const source = String(current.source || '').trim();
  if (TERMINAL_PUNCTUATION.test(source)) return true;
  if (
    next &&
    finiteNumber(next.start, 0) - finiteNumber(current.end, 0) >= 1.25
  ) {
    return true;
  }
  return false;
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSemanticBoundary,
  validateSubtitleSegments,
} from '../src/subtitle-quality.mjs';

test('subtitle validation reports completeness, overlap, speed, layout, and glossary failures', () => {
  const result = validateSubtitleSegments(
    [
      {
        id: 'seg_1',
        index: 1,
        start: 0,
        end: 0.4,
        source: 'Sam Altman made a careful decision.',
        translation: 'Sam Altman made a careful decision.',
      },
      {
        id: 'seg_2',
        index: 2,
        start: 0.3,
        end: 2,
        source: 'Next.',
        translation: '',
      },
    ],
    {
      targetLanguage: 'Korean',
      glossary: { 'Sam Altman': '샘 알트먼' },
      maxCharactersPerLine: 12,
      mediaDurationSeconds: 12,
    }
  );
  assert.equal(result.passed, false);
  const codes = new Set(result.issues.map(item => item.code));
  for (const code of [
    'duration_too_short',
    'reading_speed_timing_constrained',
    'line_too_long',
    'suspicious_untranslated_text',
    'glossary_mismatch',
    'missing_translation',
    'timestamp_overlap',
    'long_final_timestamp_gap',
  ]) {
    assert.ok(codes.has(code), code);
  }
});

test('immutable sub-minimum cue timing reports excessive speed as a warning', () => {
  const result = validateSubtitleSegments(
    [
      {
        id: 'short-cue',
        index: 1,
        start: 0,
        end: 0.05,
        source: 'Go.',
        translation: '가나다라마바',
      },
    ],
    {
      targetLanguage: 'Korean',
      mediaDurationSeconds: 0.05,
    }
  );

  assert.equal(result.passed, true);
  assert.equal(result.error_count, 0);
  assert.equal(result.warning_code_counts.duration_too_short, 1);
  assert.equal(
    result.warning_code_counts.reading_speed_timing_constrained,
    1
  );
  assert.equal(result.error_code_counts.reading_speed_excessive, undefined);
});

test('ordinary-duration excessive reading speed remains a correction error', () => {
  const result = validateSubtitleSegments(
    [
      {
        id: 'verbose-cue',
        index: 1,
        start: 0,
        end: 1,
        source: 'Brief source.',
        translation: '가'.repeat(40),
      },
    ],
    {
      targetLanguage: 'Korean',
      mediaDurationSeconds: 1,
    }
  );

  assert.equal(result.passed, false);
  assert.equal(result.error_code_counts.reading_speed_excessive, 1);
  assert.equal(
    result.warning_code_counts.reading_speed_timing_constrained,
    undefined
  );
});

test('subtitle coverage distinguishes a quiet ending from cues beyond the media', () => {
  const quietEnding = validateSubtitleSegments(
    [{ id: 'one', start: 0, end: 2, source: 'One.' }],
    { mode: 'source', mediaDurationSeconds: 20 }
  );
  assert.equal(quietEnding.passed, true);
  assert.ok(
    quietEnding.issues.some(issue => issue.code === 'long_final_timestamp_gap')
  );

  const beyondMedia = validateSubtitleSegments(
    [{ id: 'one', start: 0, end: 14, source: 'One.' }],
    { mode: 'source', mediaDurationSeconds: 10 }
  );
  assert.equal(beyondMedia.passed, false);
  assert.ok(
    beyondMedia.issues.some(
      issue => issue.code === 'subtitle_exceeds_media_duration'
    )
  );
});

test('ordinary Korean subtitles pass deterministic quality checks', () => {
  const result = validateSubtitleSegments(
    [
      {
        id: 'seg_1',
        index: 1,
        start: 0,
        end: 2.5,
        source: 'Sam Altman is ready.',
        translation: '샘 알트먼은 준비됐습니다.',
      },
      {
        id: 'seg_2',
        index: 2,
        start: 2.6,
        end: 5,
        source: 'Let us begin.',
        translation: '시작하겠습니다.',
      },
    ],
    {
      targetLanguage: 'Korean',
      glossary: { 'Sam Altman': '샘 알트먼' },
      mediaDurationSeconds: 5,
      maxCharactersPerLine: 24,
      preferredCharactersPerSecond: 12,
    }
  );
  assert.equal(result.passed, true);
  assert.equal(result.error_count, 0);
});

test('glossary validation finds overlapping terms case-insensitively in one source pass', () => {
  const result = validateSubtitleSegments(
    [
      {
        id: 'first',
        start: 0,
        end: 3,
        source: 'SAM ALTMAN explained the plan.',
        translation: '샘 알트먼이 계획을 설명했습니다.',
      },
      {
        id: 'second',
        start: 3,
        end: 6,
        source: 'Sam Altman returned.',
        translation: '샘이 돌아왔습니다.',
      },
    ],
    {
      targetLanguage: 'Korean',
      glossary: {
        'Sam Altman': '샘 알트먼',
        Altman: '알트먼',
      },
    }
  );

  assert.equal(result.warning_code_counts.glossary_mismatch, 2);
  assert.equal(result.warning_code_counts.inconsistent_name, 2);
});

test('semantic boundaries recognize punctuation and meaningful time gaps', () => {
  assert.equal(
    isSemanticBoundary(
      { source: 'A complete thought.', end: 1 },
      { source: 'Next', start: 1.1 }
    ),
    true
  );
  assert.equal(
    isSemanticBoundary(
      { source: 'Still speaking', end: 1 },
      { source: 'after a pause', start: 2.5 }
    ),
    true
  );
  assert.equal(
    isSemanticBoundary(
      { source: 'Still speaking', end: 1 },
      { source: 'without pause', start: 1.1 }
    ),
    false
  );
});

test('empty documents and broken punctuation cannot silently pass quality checks', () => {
  const empty = validateSubtitleSegments([], { mode: 'source' });
  assert.equal(empty.passed, false);
  assert.ok(
    empty.issues.some(issue => issue.code === 'empty_subtitle_document')
  );

  const broken = validateSubtitleSegments(
    [
      {
        id: 'late',
        index: 1,
        start: 12,
        end: 15,
        source: 'Source',
        translation: '괄호가 (닫히지 않았습니다.',
      },
    ],
    { targetLanguage: 'Korean' }
  );
  assert.ok(broken.issues.some(issue => issue.code === 'broken_punctuation'));
  assert.ok(
    broken.issues.some(issue => issue.code === 'long_initial_timestamp_gap')
  );
});

test('validation bounds issue details while retaining exact totals and correction errors', () => {
  const result = validateSubtitleSegments(
    [
      {
        id: 'warning-first',
        start: 0,
        end: 3,
        source: 'A normal source cue.',
        translation: '자막 한 줄이 설정된 길이보다 깁니다.',
      },
      { id: 'error-1', start: 3, end: 5, source: 'One.', translation: '' },
      { id: 'error-2', start: 5, end: 7, source: 'Two.', translation: '' },
      { id: 'error-3', start: 7, end: 9, source: 'Three.', translation: '' },
    ],
    {
      targetLanguage: 'Korean',
      maxCharactersPerLine: 5,
      maxIssueDetails: 2,
    }
  );

  assert.equal(result.error_count, 3);
  assert.equal(result.error_code_counts.missing_translation, 3);
  assert.ok(result.warning_count >= 1);
  assert.equal(
    result.total_issue_count,
    result.error_count + result.warning_count
  );
  assert.equal(result.issues.length, 2);
  assert.equal(result.issues_truncated, true);
  assert.equal(
    result.omitted_issue_count,
    result.total_issue_count - result.issues.length
  );
  assert.ok(result.issues.every(item => item.severity === 'error'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_SCHEMAS, mapFields } from '../src/packaged-mcp.mjs';
import {
  MCP_V2_TOOL_DEFINITIONS,
  WATCH_JOB_MAX_WAIT_MS,
} from '../src/mcp-v2-contract.mjs';
import {
  parseToolArguments,
  validateJsonSchema,
} from '../src/tool-schema-validator.mjs';

test('MCP controls the same caption size as the editor and rejects invalid sizes', () => {
  assert.deepEqual(
    mapFields(
      parseToolArguments(TOOL_SCHEMAS.app_set_subtitle_style, {
        style: 'LineBox',
        base_font_size_px: 35,
      })
    ),
    { style: 'LineBox', baseFontSizePx: 35 }
  );
  assert.throws(() =>
    parseToolArguments(TOOL_SCHEMAS.app_set_subtitle_style, {
      style: 'LineBox',
      base_font_size_px: 0,
    })
  );
});

test('packaged tool validation accepts valid arguments and applies advertised defaults', () => {
  const input = { id: 'download-1' };
  assert.deepEqual(parseToolArguments(TOOL_SCHEMAS.app_downloads_open, input), {
    id: 'download-1',
    replace_subtitles: 'fail',
  });
  assert.deepEqual(input, { id: 'download-1' }, 'input must not be mutated');
  assert.deepEqual(
    parseToolArguments(TOOL_SCHEMAS.app_start_media_workflow, {}),
    {
      quality: '1080p',
      run_to: 'transcribe',
      include_highlights: true,
      replace_subtitles: 'fail',
    }
  );
});

test('plan validation allows a saved profile to supply the target language', () => {
  assert.deepEqual(
    parseToolArguments(MCP_V2_TOOL_DEFINITIONS.plan_job.inputSchema, {
      source: { mock: true },
      project_profile: 'stage5_korean',
      translation_provider: 'agent',
    }),
    {
      source: { mock: true },
      project_profile: 'stage5_korean',
      transcription_method: 'stage5',
      translation_provider: 'agent',
      include_summary: false,
      include_highlights: false,
      summary_effort_level: 'standard',
      include_dubbing: false,
      quality: '1080p',
    }
  );
});

test('watch_job accepts the advertised fifty-second long-poll ceiling', () => {
  const schema = MCP_V2_TOOL_DEFINITIONS.watch_job.inputSchema;
  assert.equal(schema.properties.wait_ms.maximum, WATCH_JOB_MAX_WAIT_MS);
  assert.equal(
    parseToolArguments(schema, {
      job_id: 'job_12345678',
      after_cursor: 9,
      wait_ms: WATCH_JOB_MAX_WAIT_MS,
    }).wait_ms,
    50_000
  );
  assert.throws(
    () =>
      parseToolArguments(schema, {
        job_id: 'job_12345678',
        wait_ms: WATCH_JOB_MAX_WAIT_MS + 1,
      }),
    /at most 50000/
  );
});

test('render-checkpoint fork schemas require exact checkpoint bindings and explicit creation confirmation', () => {
  const sha256 = 'a'.repeat(64);
  const preflight = {
    source_job_id: 'job_12345678',
    expected: {
      source_key: `file:sha256:${sha256}`,
      source_checkpoint_sha256: sha256,
      source_checkpoint_bytes: 123,
      translation_session_sha256: sha256,
      accepted_segment_count: 5_700,
      target_language: 'Korean',
      validation_sha256: sha256,
      credit_ledger_sha256: sha256,
      credit_ledger_value_field: 'consumed_stage5_credits',
      credit_ledger_value: 147_319,
    },
    render_override: { style: 'LineBox', base_font_size_px: 40 },
  };
  assert.deepEqual(
    parseToolArguments(
      MCP_V2_TOOL_DEFINITIONS.preflight_render_checkpoint_fork.inputSchema,
      preflight
    ),
    preflight
  );
  assert.throws(
    () =>
      parseToolArguments(
        MCP_V2_TOOL_DEFINITIONS.create_render_checkpoint_fork.inputSchema,
        {
          ...preflight,
          preflight_digest: sha256,
          idempotency_key: 'recovery-fork-1',
        }
      ),
    /confirm.*required/
  );
  assert.throws(
    () =>
      parseToolArguments(
        MCP_V2_TOOL_DEFINITIONS.create_render_checkpoint_fork.inputSchema,
        {
          ...preflight,
          preflight_digest: sha256,
          idempotency_key: 'recovery-fork-1',
          confirm: 'RENDER_NOW',
        }
      ),
    /confirm.*must equal/
  );
});

test('packaged tool validation enforces required, type, enum, bounds, and unknown-field constraints', () => {
  assert.throws(
    () => parseToolArguments(TOOL_SCHEMAS.app_navigate, {}),
    /destination.*required/
  );
  assert.throws(
    () =>
      parseToolArguments(TOOL_SCHEMAS.app_navigate, {
        destination: 'home',
        screen: 'settings',
      }),
    /screen.*not allowed/
  );
  assert.throws(
    () =>
      parseToolArguments(TOOL_SCHEMAS.app_navigate, {
        destination: 'somewhere',
      }),
    /must be one of/
  );
  assert.throws(
    () =>
      parseToolArguments(TOOL_SCHEMAS.app_downloads_list, {
        limit: 1.5,
      }),
    /must be integer/
  );
  assert.throws(
    () =>
      parseToolArguments(TOOL_SCHEMAS.app_status, {
        history_id: 'x'.repeat(513),
      }),
    /at most 512/
  );
  assert.throws(
    () =>
      parseToolArguments(TOOL_SCHEMAS.app_video_batch_download, {
        result_ids: [],
      }),
    /at least 1 items/
  );
  assert.throws(
    () =>
      parseToolArguments(TOOL_SCHEMAS.app_open_web_page, {
        url: 'not a URI',
      }),
    /absolute URI/
  );
});

test('packaged tool validation enforces conditional and composite schemas', () => {
  assert.throws(
    () =>
      parseToolArguments(TOOL_SCHEMAS.app_subtitles_mutate, {
        operation: 'remove',
        id: 'cue-1',
      }),
    /confirm.*required/
  );
  assert.throws(
    () =>
      parseToolArguments(TOOL_SCHEMAS.app_subtitles_mutate, {
        operation: 'shift_all',
        seconds: 0,
      }),
    /forbidden shape/
  );
  assert.throws(
    () =>
      parseToolArguments(TOOL_SCHEMAS.app_subtitles_update, {
        updates: [{ id: 'cue-1' }],
      }),
    /does not satisfy any allowed shape/
  );
  assert.throws(
    () =>
      parseToolArguments(TOOL_SCHEMAS.app_start_media_workflow, {
        url: 'https://example.com/video',
        path: '/tmp/video.mp4',
      }),
    /forbidden shape/
  );
  assert.equal(
    validateJsonSchema(TOOL_SCHEMAS.app_subtitles_mutate, {
      operation: 'remove',
      id: 'cue-1',
      confirm: 'REMOVE',
    }),
    null
  );
});

test('packaged tool validation rejects duplicate values in unique arrays', () => {
  assert.throws(
    () =>
      parseToolArguments(
        {
          type: 'object',
          properties: {
            formats: {
              type: 'array',
              items: { type: 'string' },
              uniqueItems: true,
            },
          },
          required: ['formats'],
          additionalProperties: false,
        },
        { formats: ['srt', 'srt'] }
      ),
    /must contain unique items/
  );
});

test('highlight MCP contracts bind cue IDs and preserve supplied playback order', () => {
  const selection = parseToolArguments(TOOL_SCHEMAS.app_highlights_set, {
    snapshot_id: 'snapshot',
    highlights: [
      {
        id: 'intro',
        title: '직접 해보세요',
        start_cue_id: 'cue-a',
        end_cue_id: 'cue-b',
      },
    ],
  });
  assert.deepEqual(mapFields(selection), {
    snapshotId: 'snapshot',
    highlights: [
      {
        id: 'intro',
        title: '직접 해보세요',
        startCueId: 'cue-a',
        endCueId: 'cue-b',
      },
    ],
  });
  assert.deepEqual(
    mapFields(
      parseToolArguments(TOOL_SCHEMAS.app_start_highlight_render, {
        snapshot_id: 'snapshot',
        highlight_ids: ['payoff', 'intro'],
        operation_id: 'render-1',
      })
    ),
    {
      snapshotId: 'snapshot',
      highlightIds: ['payoff', 'intro'],
      operationId: 'render-1',
      aspectMode: 'vertical_fit',
    }
  );
  assert.throws(() =>
    parseToolArguments(TOOL_SCHEMAS.app_start_highlight_render, {
      snapshot_id: 's',
      highlight_ids: ['a', 'a'],
    })
  );
  assert.throws(() =>
    parseToolArguments(TOOL_SCHEMAS.app_start_highlight_render, {
      highlight_ids: ['a'],
    })
  );
});

test('packaged MCP preserves a structured editorial Short and rejects invalid framing', () => {
  const input = {
    snapshot_id: 'source-snapshot',
    highlights: [
      {
        id: 'shipping',
        title: 'AI and shipping',
        start_cue_id: 'cue-a',
        end_cue_id: 'cue-b',
        editorial: {
          label: 'Paul Graham',
          shots: [
            { start: 0, end: 4, centerX: 0.64, centerY: 0.48, zoom: 1.2 },
          ],
          captions: [
            { start: 0, end: 4, text: 'Ideas first', emphasis: 'Ideas' },
          ],
        },
      },
    ],
  };
  const mapped = mapFields(
    parseToolArguments(TOOL_SCHEMAS.app_highlights_set, input)
  );
  assert.deepEqual(
    mapped.highlights[0].editorial,
    input.highlights[0].editorial
  );
  assert.equal(mapped.highlights[0].startCueId, 'cue-a');
  input.highlights[0].editorial.shots[0].centerX = 3;
  assert.throws(() =>
    parseToolArguments(TOOL_SCHEMAS.app_highlights_set, input)
  );
});

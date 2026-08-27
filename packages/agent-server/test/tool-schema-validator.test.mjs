import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_SCHEMAS } from '../src/packaged-mcp.mjs';
import {
  MCP_V2_TOOL_DEFINITIONS,
  WATCH_JOB_MAX_WAIT_MS,
} from '../src/mcp-v2-contract.mjs';
import {
  parseToolArguments,
  validateJsonSchema,
} from '../src/tool-schema-validator.mjs';

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

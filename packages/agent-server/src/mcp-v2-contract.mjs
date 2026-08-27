export const MCP_V2_PROTOCOL_VERSION = '2.0.0';
export const MCP_V2_SCHEMA_VERSION = 1;
export const MCP_SERVER_VERSION = '0.2.3';
export const WATCH_JOB_DEFAULT_WAIT_MS = 25_000;
export const WATCH_JOB_MAX_WAIT_MS = 50_000;

export const MCP_SERVER_NAMES = Object.freeze({
  development: 'translator-development-mcp',
  production: 'translator-production-mcp',
});

export const JOB_STATUSES = Object.freeze([
  'queued',
  'starting',
  'running',
  'waiting_for_agent',
  'pause_requested',
  'paused',
  'cancel_requested',
  'cancelled',
  'blocked',
  'failed',
  'completed',
]);

export const ENCODING_PRESETS = Object.freeze([
  'youtube_1080p',
  'youtube_4k',
  'x_long_video_720p',
  'x_long_video_1080p',
  'archive_master',
  'preview_low_resolution',
]);

export const BUILTIN_PROJECT_PROFILES = Object.freeze({
  stage5_korean: Object.freeze({
    name: 'stage5_korean',
    target_language: 'Korean',
    translation_style: Object.freeze({
      natural_not_literal: true,
      preserve_tone_and_intensity: true,
      concise_subtitle_phrasing: true,
      max_lines: 2,
      max_characters_per_line: 24,
      preferred_characters_per_second: 12,
    }),
    glossary: Object.freeze({
      'Sam Altman': '샘 알트먼',
      'Andrew Huberman': '앤드류 휴버먼',
    }),
    metadata: Object.freeze({
      description_format: 'concise_korean',
      bullet_style: 'bullets_without_explanatory_paragraphs',
      source_link_format: 'original_source',
    }),
    output_presets: Object.freeze({
      youtube: 'youtube_1080p',
      x: 'x_long_video_720p',
    }),
    publishing: Object.freeze({
      youtube: Object.freeze({
        account: null,
        channel: null,
        visibility: 'private',
        made_for_kids: false,
        playlist: null,
      }),
      x: Object.freeze({
        account: null,
      }),
    }),
    subtitle_rendering: Object.freeze({
      display_mode: 'translation',
      style: 'Default',
      font_size: 24,
      max_lines: 2,
    }),
  }),
});

const emptyObjectSchema = Object.freeze({
  type: 'object',
  properties: {},
  additionalProperties: false,
});

const jobIdProperty = Object.freeze({
  type: 'string',
  minLength: 8,
  maxLength: 80,
});
const cursorProperty = Object.freeze({
  type: 'integer',
  minimum: 0,
  default: 0,
});
const sha256Property = Object.freeze({
  type: 'string',
  minLength: 64,
  maxLength: 64,
  pattern: '^[a-f0-9]{64}$',
});

const sourceSchema = Object.freeze({
  type: 'object',
  properties: {
    url: { type: 'string', format: 'uri', maxLength: 32768 },
    path: { type: 'string', minLength: 1, maxLength: 4096 },
    history_id: { type: 'string', minLength: 1, maxLength: 512 },
    transcript_path: { type: 'string', minLength: 1, maxLength: 4096 },
    mock: { const: true },
  },
  anyOf: [
    { required: ['url'] },
    { required: ['path'] },
    { required: ['history_id'] },
    { required: ['transcript_path'] },
    { required: ['mock'] },
  ],
  allOf: [
    { not: { required: ['url', 'path'] } },
    { not: { required: ['url', 'history_id'] } },
    { not: { required: ['url', 'transcript_path'] } },
    { not: { required: ['path', 'history_id'] } },
    { not: { required: ['path', 'transcript_path'] } },
    { not: { required: ['history_id', 'transcript_path'] } },
    { not: { required: ['mock', 'url'] } },
    { not: { required: ['mock', 'path'] } },
    { not: { required: ['mock', 'history_id'] } },
    { not: { required: ['mock', 'transcript_path'] } },
  ],
  additionalProperties: false,
});

const outputOptionsSchema = Object.freeze({
  type: 'object',
  properties: {
    output_directory: { type: 'string', minLength: 1, maxLength: 4096 },
    base_name: { type: 'string', minLength: 1, maxLength: 180 },
    presets: {
      type: 'array',
      items: { type: 'string', enum: ENCODING_PRESETS },
      minItems: 1,
      maxItems: 6,
      uniqueItems: true,
    },
    subtitle_formats: {
      type: 'array',
      items: { type: 'string', enum: ['srt', 'vtt', 'ass'] },
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
      default: ['srt'],
    },
    burn_subtitles: { type: 'boolean', default: true },
    subtitle_display_mode: {
      type: 'string',
      enum: ['original', 'translation', 'dual'],
    },
    subtitle_style: {
      type: 'string',
      enum: ['Default', 'Classic', 'Boxed', 'LineBox'],
    },
    subtitle_font_size: {
      type: 'number',
      minimum: 12,
      maximum: 96,
    },
    x_account_tier: {
      type: 'string',
      enum: ['standard', 'premium'],
      default: 'standard',
    },
    overwrite: { type: 'boolean', default: false },
  },
  additionalProperties: false,
});

const nullableProfileText = maxLength => ({
  anyOf: [{ type: 'string', maxLength }, { enum: [null] }],
});

const projectProfileSchema = Object.freeze({
  type: 'object',
  properties: {
    target_language: { type: 'string', minLength: 2, maxLength: 80 },
    translation_style: {
      type: 'object',
      properties: {
        natural_not_literal: { type: 'boolean' },
        preserve_tone_and_intensity: { type: 'boolean' },
        concise_subtitle_phrasing: { type: 'boolean' },
        max_lines: { type: 'integer', minimum: 1, maximum: 4 },
        max_characters_per_line: {
          type: 'integer',
          minimum: 8,
          maximum: 200,
        },
        preferred_characters_per_second: {
          type: 'number',
          minimum: 1,
          maximum: 100,
        },
      },
      additionalProperties: false,
    },
    glossary: {
      type: 'object',
      maxProperties: 1000,
      additionalProperties: {
        type: 'string',
        minLength: 1,
        maxLength: 500,
      },
    },
    metadata: {
      type: 'object',
      properties: Object.fromEntries(
        [
          'description_format',
          'bullet_style',
          'source_link_format',
          'youtube_description_template',
          'x_post_template',
          'naming_conventions',
        ].map(key => [key, { type: 'string', maxLength: 20_000 }])
      ),
      additionalProperties: false,
    },
    output_presets: {
      type: 'object',
      properties: Object.fromEntries(
        ['youtube', 'x', 'archive', 'preview'].map(key => [
          key,
          { type: 'string', enum: ENCODING_PRESETS },
        ])
      ),
      additionalProperties: false,
    },
    subtitle_rendering: {
      type: 'object',
      properties: {
        display_mode: {
          type: 'string',
          enum: ['original', 'translation', 'dual'],
        },
        style: {
          type: 'string',
          enum: ['Default', 'Classic', 'Boxed', 'LineBox'],
        },
        font_size: { type: 'number', minimum: 12, maximum: 96 },
        max_lines: { type: 'integer', minimum: 1, maximum: 4 },
      },
      additionalProperties: false,
    },
    publishing: {
      type: 'object',
      properties: {
        youtube: {
          type: 'object',
          properties: {
            account: nullableProfileText(200),
            channel: nullableProfileText(200),
            visibility: {
              type: 'string',
              enum: ['private', 'unlisted', 'public'],
            },
            made_for_kids: { type: 'boolean' },
            playlist: nullableProfileText(200),
          },
          additionalProperties: false,
        },
        x: {
          type: 'object',
          properties: { account: nullableProfileText(200) },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
});

const planJobSchema = Object.freeze({
  type: 'object',
  properties: {
    source: sourceSchema,
    transcription_method: {
      type: 'string',
      enum: [
        'stage5',
        'byo',
        'creator_captions',
        'youtube_auto_captions',
        'imported_transcript',
        'reuse',
        'none',
      ],
      default: 'stage5',
    },
    translation_provider: {
      type: 'string',
      enum: ['agent', 'stage5', 'byo', 'none'],
      default: 'agent',
    },
    target_language: { type: 'string', minLength: 2, maxLength: 80 },
    caption_language: { type: 'string', minLength: 1, maxLength: 64 },
    imported_transcript_path: {
      type: 'string',
      minLength: 1,
      maxLength: 4096,
    },
    project_profile: { type: 'string', minLength: 1, maxLength: 80 },
    per_video_glossary: {
      type: 'object',
      maxProperties: 1000,
      additionalProperties: { type: 'string', minLength: 1, maxLength: 500 },
    },
    include_summary: { type: 'boolean', default: false },
    include_highlights: { type: 'boolean', default: false },
    summary_effort_level: {
      type: 'string',
      enum: ['standard', 'high'],
      default: 'standard',
    },
    include_dubbing: { type: 'boolean', default: false },
    voice: {
      type: 'string',
      enum: [
        'rachel',
        'adam',
        'josh',
        'sarah',
        'charlie',
        'emily',
        'matilda',
        'brian',
        'alloy',
        'echo',
        'fable',
        'onyx',
        'nova',
        'shimmer',
      ],
    },
    outputs: outputOptionsSchema,
    quality: {
      type: 'string',
      enum: [
        'high',
        'mid',
        'low',
        '4320p',
        '2160p',
        '1440p',
        '1080p',
        '720p',
        '480p',
        '360p',
        '240p',
      ],
      default: '1080p',
    },
  },
  required: ['source'],
  additionalProperties: false,
});

const renderCheckpointForkExpectedSchema = Object.freeze({
  type: 'object',
  properties: {
    source_key: { type: 'string', minLength: 1, maxLength: 4096 },
    source_checkpoint_sha256: sha256Property,
    source_checkpoint_bytes: { type: 'integer', minimum: 1 },
    translation_session_sha256: sha256Property,
    accepted_segment_count: {
      type: 'integer',
      minimum: 1,
      maximum: 100_000,
    },
    target_language: { type: 'string', minLength: 2, maxLength: 80 },
    validation_sha256: sha256Property,
    credit_ledger_sha256: sha256Property,
    credit_ledger_value_field: {
      type: 'string',
      enum: [
        'estimated_stage5_credits',
        'authorized_stage5_credits',
        'consumed_stage5_credits',
      ],
    },
    credit_ledger_value: { type: 'integer', minimum: 0 },
  },
  required: [
    'source_key',
    'source_checkpoint_sha256',
    'source_checkpoint_bytes',
    'translation_session_sha256',
    'accepted_segment_count',
    'target_language',
    'validation_sha256',
    'credit_ledger_sha256',
    'credit_ledger_value_field',
    'credit_ledger_value',
  ],
  additionalProperties: false,
});

const renderCheckpointForkOverrideSchema = Object.freeze({
  type: 'object',
  properties: {
    style: {
      type: 'string',
      enum: ['Default', 'Classic', 'Boxed', 'LineBox'],
    },
    base_font_size_px: { type: 'number', minimum: 12, maximum: 96 },
  },
  required: ['style', 'base_font_size_px'],
  additionalProperties: false,
});

const renderCheckpointForkPreflightProperties = Object.freeze({
  source_job_id: jobIdProperty,
  expected: renderCheckpointForkExpectedSchema,
  render_override: renderCheckpointForkOverrideSchema,
});

export const MCP_V2_TOOL_DEFINITIONS = Object.freeze({
  get_server_info: {
    description:
      'Return unambiguous environment, app/server versions, masked Stage5 identity, current credit balance, and connection state. Never consumes credit.',
    inputSchema: emptyObjectSchema,
    billing: 'none',
  },
  get_capabilities: {
    description:
      'Return machine-readable MCP schema versions, languages, providers, formats, presets, limits, and publishing availability. Never consumes credit.',
    inputSchema: emptyObjectSchema,
    billing: 'none',
  },
  doctor: {
    description:
      'Check Translator connectivity, versions, FFmpeg, yt-dlp, disk space, Stage5 status, credit balance, codecs, and writable output directories. Never consumes credit.',
    inputSchema: {
      type: 'object',
      properties: {
        check_network: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
    billing: 'none',
  },
  probe_source: {
    description:
      'Inspect a URL, local media file, library item, transcript, or mock source before downloading or spending credit.',
    inputSchema: {
      type: 'object',
      properties: { source: sourceSchema },
      required: ['source'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  plan_job: {
    description:
      'Create a no-cost immutable workflow plan with providers, Stage5 credit estimate, compatibility findings, outputs, time/disk ranges, and a plan hash.',
    inputSchema: planJobSchema,
    billing: 'none',
  },
  preflight_render_checkpoint_fork: {
    description:
      'Pure read-only eligibility check for a render-only fork of an exact canceled source, accepted translation session, validation receipt, and credit ledger. It creates no plan or job, calls no provider, reserves no credit, and renders nothing.',
    inputSchema: {
      type: 'object',
      properties: renderCheckpointForkPreflightProperties,
      required: ['source_job_id', 'expected', 'render_override'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  create_render_checkpoint_fork: {
    description:
      'Create an idempotent local render-only fork bound to an eligible preflight digest. The fork starts blocked at render_outputs, contains no transcription or translation stage, spends no Stage5 credit, and does not render until render_outputs is separately authorized.',
    inputSchema: {
      type: 'object',
      properties: {
        ...renderCheckpointForkPreflightProperties,
        preflight_digest: sha256Property,
        idempotency_key: { type: 'string', minLength: 8, maxLength: 200 },
        confirm: { const: 'CREATE_RENDER_CHECKPOINT_FORK' },
      },
      required: [
        'source_job_id',
        'expected',
        'render_override',
        'preflight_digest',
        'idempotency_key',
        'confirm',
      ],
      additionalProperties: false,
    },
    billing: 'none',
  },
  create_job: {
    description:
      'Create and start an idempotent persistent job from an existing plan. Paid plans require explicit confirmation of a maximum accepted preflight estimate; this is an authorization gate, not a backend-enforced absolute spend cap.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_hash: { type: 'string', minLength: 64, maxLength: 64 },
        idempotency_key: { type: 'string', minLength: 8, maxLength: 200 },
        credit_authorization: {
          type: 'object',
          properties: {
            max_stage5_credits: {
              type: 'integer',
              minimum: 0,
              description:
                'Largest preflight estimate the caller accepts. It prevents starting a plan whose estimate is higher, but does not cap provider settlement after work begins.',
            },
            confirm: { type: 'string', enum: ['AUTHORIZE_STAGE5_CREDITS'] },
          },
          required: ['max_stage5_credits', 'confirm'],
          additionalProperties: false,
        },
      },
      required: ['plan_hash', 'idempotency_key'],
      additionalProperties: false,
    },
    billing: 'planned',
  },
  get_job: {
    description:
      'Reconcile and return one persistent job, its exact stage/progress, recoverability, credit ledger, artifacts, and events after a cursor.',
    inputSchema: {
      type: 'object',
      properties: { job_id: jobIdProperty, after_cursor: cursorProperty },
      required: ['job_id'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  list_jobs: {
    description:
      'List prior persistent jobs without returning transcripts or large artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: JOB_STATUSES },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
      additionalProperties: false,
    },
    billing: 'none',
  },
  watch_job: {
    description:
      'Wait for persisted job changes after an event cursor, returning immediately when state changes. Reconciliation may advance only stages already authorized by the persisted job; this call never grants new paid-stage authorization.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: jobIdProperty,
        after_cursor: cursorProperty,
        wait_ms: {
          type: 'integer',
          minimum: 0,
          maximum: WATCH_JOB_MAX_WAIT_MS,
          default: WATCH_JOB_DEFAULT_WAIT_MS,
        },
      },
      required: ['job_id'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  pause_job: {
    description:
      'Request a persistent job pause at its next safe checkpoint. Paid in-flight stages finish rather than being duplicated.',
    inputSchema: {
      type: 'object',
      properties: { job_id: jobIdProperty },
      required: ['job_id'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  resume_job: {
    description:
      'Resume an explicitly paused job from its latest validated checkpoint. Blocked or failed stages require retry_stage.',
    inputSchema: {
      type: 'object',
      properties: { job_id: jobIdProperty },
      required: ['job_id'],
      additionalProperties: false,
    },
    billing: 'planned',
  },
  cancel_job: {
    description:
      'Cancel a job idempotently while preserving every already validated artifact and the audit trail.',
    inputSchema: {
      type: 'object',
      properties: { job_id: jobIdProperty },
      required: ['job_id'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  retry_stage: {
    description:
      'Retry only the failed stage with the original stable operation identity. A paid-stage retry requires the explicit RETRY_PAID_STAGE confirmation because the earlier attempt may already have consumed provider credit.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: jobIdProperty,
        stage: { type: 'string', minLength: 1, maxLength: 120 },
        confirm_paid_retry: { type: 'string', enum: ['RETRY_PAID_STAGE'] },
      },
      required: ['job_id'],
      additionalProperties: false,
    },
    billing: 'planned',
  },
  get_transcript_batch: {
    description:
      'Return one context-aware batch for external-agent translation with stable segment IDs, context, glossary, and a submission-bound batch ID.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: jobIdProperty,
        mode: {
          type: 'string',
          enum: ['translate', 'review'],
          default: 'translate',
        },
        max_segments: { type: 'integer', minimum: 1, maximum: 40, default: 16 },
      },
      required: ['job_id'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  submit_translation_batch: {
    description:
      'Validate and atomically accept exactly one issued translation batch. Missing, duplicate, extra, stale, or invented IDs are rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: jobIdProperty,
        batch_id: { type: 'string', minLength: 8, maxLength: 120 },
        translations: {
          type: 'array',
          minItems: 1,
          maxItems: 40,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 200 },
              text: { type: 'string', minLength: 1, maxLength: 10000 },
            },
            required: ['id', 'text'],
            additionalProperties: false,
          },
        },
      },
      required: ['job_id', 'batch_id', 'translations'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  validate_translation: {
    description:
      'Run deterministic subtitle timing, readability, completeness, glossary, character-encoding, duplication, and duration checks without spending credit. Use render_preview for visual font/glyph verification.',
    inputSchema: {
      type: 'object',
      properties: { job_id: jobIdProperty },
      required: ['job_id'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  get_project_profile: {
    description: 'Read a built-in or saved translation/output profile.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
      required: ['name'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  save_project_profile: {
    description:
      'Persist a project translation, glossary, subtitle-style, metadata, and output profile locally. Never stores credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 80 },
        profile: projectProfileSchema,
      },
      required: ['name', 'profile'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  render_preview: {
    description:
      'Render representative beginning, middle, and end preview frames using the planned subtitle style before a full encode.',
    inputSchema: {
      type: 'object',
      properties: { job_id: jobIdProperty },
      required: ['job_id'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  render_outputs: {
    description:
      'Start planned output rendering only after translation validation passes. Rendering itself consumes no Stage5 credit.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: jobIdProperty,
        allow_warnings: { type: 'boolean', default: false },
      },
      required: ['job_id'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  verify_outputs: {
    description:
      'Inspect output codecs, pixel format, dimensions, frame rate, duration, fast-start layout, size, hashes, and preset compatibility, then extract hashed beginning/middle/end frames from each finished render.',
    inputSchema: {
      type: 'object',
      properties: { job_id: jobIdProperty },
      required: ['job_id'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  get_job_manifest: {
    description:
      'Return the concise final artifact manifest and its file reference without dumping transcripts into the response.',
    inputSchema: {
      type: 'object',
      properties: { job_id: jobIdProperty },
      required: ['job_id'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  prepare_youtube_upload: {
    description:
      'Prepare and validate a non-public YouTube upload descriptor. This never uploads or publishes.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: jobIdProperty,
        title: { type: 'string', minLength: 1, maxLength: 100 },
        description: { type: 'string', maxLength: 5000 },
        visibility: { type: 'string', enum: ['private', 'unlisted', 'public'] },
        playlist: { type: 'string', maxLength: 200 },
        made_for_kids: { type: 'boolean' },
      },
      required: ['job_id', 'title'],
      additionalProperties: false,
    },
    billing: 'none',
  },
  prepare_x_post: {
    description:
      'Prepare and validate a non-public X post descriptor and attached artifact. This never uploads or publishes.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: jobIdProperty,
        text: { type: 'string', minLength: 1, maxLength: 25000 },
      },
      required: ['job_id', 'text'],
      additionalProperties: false,
    },
    billing: 'none',
  },
});

export const MCP_V2_TOOL_NAMES = Object.freeze(
  Object.keys(MCP_V2_TOOL_DEFINITIONS)
);

export function getMcpToolBilling(toolName, args = {}, context = null) {
  const definition = MCP_V2_TOOL_DEFINITIONS[toolName];
  const policy = definition?.billing || 'unknown';
  if (policy === 'none') {
    return {
      may_consume_stage5_credits: false,
      will_consume_stage5_credits: false,
      reason:
        'This tool is locally read-only or performs a no-credit operation.',
    };
  }

  if (
    toolName === 'create_job' ||
    toolName === 'resume_job' ||
    toolName === 'retry_stage'
  ) {
    return {
      may_consume_stage5_credits: true,
      will_consume_stage5_credits: null,
      reason:
        'The persisted plan and credit authorization determine whether the next checkpoint is paid.',
    };
  }

  const operation = context?.billing?.operations?.[toolName] || null;
  return {
    may_consume_stage5_credits: policy !== 'none',
    will_consume_stage5_credits:
      typeof operation?.willConsumeStage5Credits === 'boolean'
        ? operation.willConsumeStage5Credits
        : null,
    provider: operation?.provider || null,
    reason:
      operation?.reason ||
      'Billing depends on the active provider configuration.',
  };
}

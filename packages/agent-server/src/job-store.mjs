import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, canonicalJsonHash } from './canonical-json.mjs';
import {
  BUILTIN_PROJECT_PROFILES,
  ENCODING_PRESETS,
  JOB_STATUSES,
  MCP_V2_SCHEMA_VERSION,
} from './mcp-v2-contract.mjs';
import {
  RENDER_CHECKPOINT_FORK_STAGES,
  buildRenderCheckpointForkPlan,
  creditLedgerCheckpointSha256,
  hasRecoverableRenderCheckpoint,
  persistentJobCheckpointSha256,
  stablePlanForEnvironment,
  translationSessionCheckpointSha256,
  validationCheckpointSha256,
} from './render-checkpoint-recovery.mjs';
import { isSemanticBoundary } from './subtitle-quality.mjs';

const TERMINAL_JOB_STATUSES = new Set(['cancelled', 'failed', 'completed']);
const VALID_JOB_STATUSES = new Set(JOB_STATUSES);
const MAX_TRANSLATION_SESSION_SEGMENTS = 100_000;
const MAX_TRANSLATION_SEGMENT_TEXT_CHARACTERS = 10_000;
const MAX_TRANSLATION_SESSION_TEXT_CHARACTERS = 32 * 1024 * 1024;
const VALID_TRANSLATION_SEGMENT_STATUSES = new Set([
  'pending',
  'translated',
  'reviewed',
  'needs_correction',
]);

function defaultRoot() {
  return path.join(os.homedir(), '.translator-agent', 'v2');
}

function normalizeEnvironment(value) {
  if (value !== 'development' && value !== 'production') {
    throw new TypeError('Job environment must be development or production.');
  }
  return value;
}

function parseJson(value, fallback = null) {
  if (typeof value !== 'string' || !value) return fallback;
  return JSON.parse(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizedStoredPathIdentity(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const resolved = path.resolve(raw);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function cleanProfileName(value) {
  const name = String(value || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name)) {
    throw new TypeError(
      'Profile name must contain 1-80 letters, numbers, underscores, or hyphens.'
    );
  }
  return name;
}

function cleanIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (key.length < 8 || key.length > 200 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new TypeError(
      'idempotency_key must contain 8-200 printable characters.'
    );
  }
  return key;
}

function cleanHash(value, label) {
  const hash = String(value || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new TypeError(`${label} must be a 64-character SHA-256 hash.`);
  }
  return hash;
}

function cleanActivityKind(value) {
  const kind = String(value || '').trim();
  if (!/^[a-z][a-z0-9_-]{0,79}$/.test(kind)) {
    throw new TypeError('Invalid job activity kind.');
  }
  return kind;
}

function cleanActivityToken(value) {
  const token = String(value || '').trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      token
    )
  ) {
    throw new TypeError('Invalid job activity token.');
  }
  return token;
}

function cleanClaimOwner(value) {
  if (
    !isObject(value) ||
    value.protocol_version !== 1 ||
    typeof value.endpoint !== 'string' ||
    !value.endpoint ||
    value.endpoint.length > 4096 ||
    !/^[a-f0-9]{64}$/.test(String(value.token || '')) ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0
  ) {
    throw new TypeError('Invalid job activity owner descriptor.');
  }
  return {
    protocol_version: 1,
    endpoint: value.endpoint,
    token: value.token,
    pid: value.pid,
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertBoundedTranslationSessionText(segments) {
  let characters = 0;
  for (const segment of segments || []) {
    characters +=
      String(segment?.source || '').length +
      String(segment?.translation || '').length +
      String(segment?.speaker || '').length +
      String(segment?.topic || '').length;
    if (characters > MAX_TRANSLATION_SESSION_TEXT_CHARACTERS) {
      throw new TypeError(
        `Translation session text cannot exceed ${MAX_TRANSLATION_SESSION_TEXT_CHARACTERS} characters.`
      );
    }
  }
}

function mergeJsonObjects(base, override) {
  const result = Object.assign(Object.create(null), clone(base || {}));
  for (const [key, value] of Object.entries(override || {})) {
    result[key] =
      isObject(value) && isObject(result[key])
        ? mergeJsonObjects(result[key], value)
        : clone(value);
  }
  return result;
}

const CREDENTIAL_FIELD_PATTERN =
  /(?:apikey|accesstoken|refreshtoken|authtoken|bearertoken|clientsecret|credential|authorization|password|privatekey|secretkey|secret)/i;

function assertCredentialFree(value, path = 'profile', seen = new Set()) {
  if (value == null || typeof value !== 'object') return;
  if (seen.has(value))
    throw new TypeError(`${path} cannot contain circular data.`);
  seen.add(value);
  // Glossary keys are source-language terms, not profile field names. The
  // strict glossary shape below permits only bounded string values, so a term
  // such as "password" or "secret" must not be mistaken for a credential.
  if (path === 'profile.glossary') {
    seen.delete(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertCredentialFree(item, `${path}[${index}]`, seen)
    );
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (CREDENTIAL_FIELD_PATTERN.test(key.replace(/[^a-zA-Z0-9]/g, ''))) {
        throw new Error(
          `Project profiles cannot store credential field: ${path}.${key}`
        );
      }
      assertCredentialFree(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function assertProfileShape(profile) {
  const assertKnownKeys = (value, allowed, label) => {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        throw new TypeError(
          `${label}.${key} is not a supported profile field.`
        );
      }
    }
  };
  assertKnownKeys(
    profile,
    new Set([
      'target_language',
      'translation_style',
      'glossary',
      'metadata',
      'output_presets',
      'subtitle_rendering',
      'publishing',
    ]),
    'profile'
  );
  const glossary = profile.glossary;
  if (glossary !== undefined) {
    if (!isObject(glossary)) {
      throw new TypeError(
        'profile.glossary must be an object of text mappings.'
      );
    }
    const entries = Object.entries(glossary);
    if (entries.length > 1000) {
      throw new TypeError(
        'profile.glossary cannot contain more than 1000 terms.'
      );
    }
    for (const [source, translation] of entries) {
      if (
        !source.trim() ||
        source.length > 500 ||
        /[\p{Cc}]/u.test(source) ||
        typeof translation !== 'string' ||
        !translation.trim() ||
        translation.length > 500 ||
        /[\p{Cc}]/u.test(translation)
      ) {
        throw new TypeError(
          'profile.glossary keys and values must be non-empty text up to 500 characters.'
        );
      }
    }
  }
  if (profile.target_language !== undefined) {
    const targetLanguage = String(profile.target_language || '').trim();
    if (
      targetLanguage.length < 2 ||
      targetLanguage.length > 80 ||
      /[\p{Cc}]/u.test(targetLanguage)
    ) {
      throw new TypeError(
        'profile.target_language must contain between 2 and 80 characters.'
      );
    }
  }
  if (profile.translation_style !== undefined) {
    if (!isObject(profile.translation_style)) {
      throw new TypeError('profile.translation_style must be an object.');
    }
    assertKnownKeys(
      profile.translation_style,
      new Set([
        'natural_not_literal',
        'preserve_tone_and_intensity',
        'concise_subtitle_phrasing',
        'max_lines',
        'max_characters_per_line',
        'preferred_characters_per_second',
      ]),
      'profile.translation_style'
    );
    for (const key of [
      'natural_not_literal',
      'preserve_tone_and_intensity',
      'concise_subtitle_phrasing',
    ]) {
      if (
        profile.translation_style[key] !== undefined &&
        typeof profile.translation_style[key] !== 'boolean'
      ) {
        throw new TypeError(
          `profile.translation_style.${key} must be boolean.`
        );
      }
    }
    for (const [key, minimum, maximum] of [
      ['max_lines', 1, 4],
      ['max_characters_per_line', 8, 200],
      ['preferred_characters_per_second', 1, 100],
    ]) {
      const value = profile.translation_style[key];
      if (
        value !== undefined &&
        (!Number.isFinite(Number(value)) ||
          (key !== 'preferred_characters_per_second' &&
            !Number.isInteger(Number(value))) ||
          Number(value) < minimum ||
          Number(value) > maximum)
      ) {
        throw new TypeError(
          `profile.translation_style.${key} must be between ${minimum} and ${maximum}.`
        );
      }
    }
  }
  if (profile.metadata !== undefined) {
    if (!isObject(profile.metadata)) {
      throw new TypeError('profile.metadata must be an object.');
    }
    assertKnownKeys(
      profile.metadata,
      new Set([
        'description_format',
        'bullet_style',
        'source_link_format',
        'youtube_description_template',
        'x_post_template',
        'naming_conventions',
      ]),
      'profile.metadata'
    );
    for (const [key, value] of Object.entries(profile.metadata)) {
      if (typeof value !== 'string' || value.length > 20_000) {
        throw new TypeError(
          `profile.metadata.${key} must be text up to 20,000 characters.`
        );
      }
    }
  }
  if (profile.output_presets !== undefined) {
    if (!isObject(profile.output_presets)) {
      throw new TypeError('profile.output_presets must be an object.');
    }
    assertKnownKeys(
      profile.output_presets,
      new Set(['youtube', 'x', 'archive', 'preview']),
      'profile.output_presets'
    );
    for (const [platform, preset] of Object.entries(profile.output_presets)) {
      if (!ENCODING_PRESETS.includes(preset)) {
        throw new TypeError(
          `profile.output_presets.${platform} must name a supported encoding preset.`
        );
      }
    }
  }
  if (profile.subtitle_rendering !== undefined) {
    const rendering = profile.subtitle_rendering;
    if (!isObject(rendering)) {
      throw new TypeError('profile.subtitle_rendering must be an object.');
    }
    assertKnownKeys(
      rendering,
      new Set(['display_mode', 'style', 'font_size', 'max_lines']),
      'profile.subtitle_rendering'
    );
    if (
      rendering.display_mode !== undefined &&
      !['original', 'translation', 'dual'].includes(rendering.display_mode)
    ) {
      throw new TypeError(
        'profile.subtitle_rendering.display_mode is unsupported.'
      );
    }
    if (
      rendering.style !== undefined &&
      !['Default', 'Classic', 'Boxed', 'LineBox'].includes(rendering.style)
    ) {
      throw new TypeError('profile.subtitle_rendering.style is unsupported.');
    }
    if (
      rendering.font_size !== undefined &&
      (!Number.isFinite(Number(rendering.font_size)) ||
        Number(rendering.font_size) < 12 ||
        Number(rendering.font_size) > 96)
    ) {
      throw new TypeError(
        'profile.subtitle_rendering.font_size must be between 12 and 96.'
      );
    }
    if (
      rendering.max_lines !== undefined &&
      (!Number.isInteger(Number(rendering.max_lines)) ||
        Number(rendering.max_lines) < 1 ||
        Number(rendering.max_lines) > 4)
    ) {
      throw new TypeError(
        'profile.subtitle_rendering.max_lines must be an integer between 1 and 4.'
      );
    }
  }
  if (profile.publishing !== undefined) {
    if (!isObject(profile.publishing)) {
      throw new TypeError('profile.publishing must be an object.');
    }
    assertKnownKeys(
      profile.publishing,
      new Set(['youtube', 'x']),
      'profile.publishing'
    );
    const youtube = profile.publishing.youtube;
    if (youtube !== undefined) {
      if (!isObject(youtube)) {
        throw new TypeError('profile.publishing.youtube must be an object.');
      }
      assertKnownKeys(
        youtube,
        new Set([
          'account',
          'channel',
          'visibility',
          'made_for_kids',
          'playlist',
        ]),
        'profile.publishing.youtube'
      );
      if (
        youtube.visibility !== undefined &&
        !['private', 'unlisted', 'public'].includes(youtube.visibility)
      ) {
        throw new TypeError(
          'profile.publishing.youtube.visibility is unsupported.'
        );
      }
      if (
        youtube.made_for_kids !== undefined &&
        typeof youtube.made_for_kids !== 'boolean'
      ) {
        throw new TypeError(
          'profile.publishing.youtube.made_for_kids must be boolean.'
        );
      }
      for (const key of ['account', 'channel', 'playlist']) {
        const value = youtube[key];
        if (
          value !== undefined &&
          value !== null &&
          (typeof value !== 'string' || value.length > 200)
        ) {
          throw new TypeError(
            `profile.publishing.youtube.${key} must be text up to 200 characters or null.`
          );
        }
      }
    }
    const x = profile.publishing.x;
    if (x !== undefined && !isObject(x)) {
      throw new TypeError('profile.publishing.x must be an object.');
    }
    if (isObject(x)) {
      assertKnownKeys(x, new Set(['account']), 'profile.publishing.x');
    }
    if (
      isObject(x) &&
      x.account !== undefined &&
      x.account !== null &&
      (typeof x.account !== 'string' || x.account.length > 200)
    ) {
      throw new TypeError(
        'profile.publishing.x.account must be text up to 200 characters or null.'
      );
    }
  }
  const serialized = canonicalJson(profile);
  if (Buffer.byteLength(serialized) > 256 * 1024) {
    throw new TypeError('Project profiles cannot exceed 256 KiB.');
  }
}

export class IdempotencyConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.code = 'IDEMPOTENCY_CONFLICT';
  }
}

export class PersistentJobStore {
  constructor({
    environment,
    root = process.env.TRANSLATOR_AGENT_JOB_ROOT || defaultRoot(),
    databasePath,
    now = () => new Date(),
  } = {}) {
    this.environment = normalizeEnvironment(environment);
    this.now = now;
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.root, 0o700);
    } catch {
      // Windows does not implement POSIX modes. Directory ACLs remain owned
      // by the current user profile.
    }
    this.databasePath =
      databasePath || path.join(this.root, `${this.environment}.sqlite3`);
    this.database = new DatabaseSync(this.databasePath);
    try {
      this.database.exec('PRAGMA busy_timeout = 5000');
      this.database.exec('PRAGMA foreign_keys = ON');
      this.database.exec('PRAGMA journal_mode = WAL');
      this.database.exec('PRAGMA synchronous = FULL');
      this.installSchema();
    } catch (error) {
      try {
        this.database.close();
      } catch {
        // Preserve the schema/open failure that made the store unusable.
      }
      this.database = null;
      throw error;
    }
    if (this.databasePath !== ':memory:') {
      try {
        fs.chmodSync(this.databasePath, 0o600);
      } catch {
        // See the Windows ACL note above.
      }
    }
  }

  installSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plans (
        plan_hash TEXT PRIMARY KEY,
        environment TEXT NOT NULL,
        created_at TEXT NOT NULL,
        request_json TEXT NOT NULL,
        plan_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        environment TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        plan_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        percent REAL NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        job_json TEXT NOT NULL,
        UNIQUE(environment, idempotency_key),
        FOREIGN KEY(plan_hash) REFERENCES plans(plan_hash)
      );
      CREATE INDEX IF NOT EXISTS jobs_environment_updated
        ON jobs(environment, updated_at DESC);
      CREATE INDEX IF NOT EXISTS jobs_environment_status_updated
        ON jobs(environment, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS job_events (
        job_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        stage TEXT,
        data_json TEXT NOT NULL,
        PRIMARY KEY(job_id, sequence),
        FOREIGN KEY(job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS profiles (
        environment TEXT NOT NULL,
        name TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        PRIMARY KEY(environment, name)
      );
      CREATE TABLE IF NOT EXISTS source_records (
        environment TEXT NOT NULL,
        source_key TEXT NOT NULL,
        job_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY(environment, source_key, job_id),
        FOREIGN KEY(job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS translation_sessions (
        job_id TEXT PRIMARY KEY,
        source_hash TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        session_json TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS translation_batches (
        batch_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        issued_revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        accepted_at TEXT,
        selection_json TEXT NOT NULL,
        response_hash TEXT,
        FOREIGN KEY(job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS translation_batches_pending
        ON translation_batches(job_id, mode, accepted_at, created_at DESC);
      CREATE TABLE IF NOT EXISTS job_control_requests (
        job_id TEXT NOT NULL,
        control_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(job_id, control_key),
        FOREIGN KEY(job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS job_activity_claims (
        job_id TEXT PRIMARY KEY,
        activity_kind TEXT NOT NULL,
        activity_token TEXT NOT NULL,
        owner_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
      );
    `);
    const existing = this.database
      .prepare("SELECT value FROM metadata WHERE key = 'schema_version'")
      .get();
    const existingVersion = existing ? Number(existing.value) : null;
    if (
      existingVersion !== null &&
      (!Number.isInteger(existingVersion) ||
        existingVersion > MCP_V2_SCHEMA_VERSION)
    ) {
      throw new Error(
        `Unsupported MCP job database schema ${existing?.value}; this helper supports ${MCP_V2_SCHEMA_VERSION}.`
      );
    }
    this.database
      .prepare(
        `INSERT INTO metadata(key, value) VALUES('schema_version', ?)
         ON CONFLICT(key) DO NOTHING`
      )
      .run(String(MCP_V2_SCHEMA_VERSION));
  }

  close() {
    if (!this.database) return;
    this.database.close();
    this.database = null;
  }

  transaction(callback) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original transactional failure.
      }
      throw error;
    }
  }

  timestamp() {
    return this.now().toISOString();
  }

  totalChanges() {
    const row = this.database.prepare('SELECT total_changes() AS value').get();
    return Number(row?.value || 0);
  }

  putPlan({ request, plan }) {
    if (!isObject(request) || !isObject(plan)) {
      throw new TypeError('Plan request and result must be JSON objects.');
    }
    const stablePlan = {
      ...clone(plan),
      schema_version: MCP_V2_SCHEMA_VERSION,
      environment: this.environment,
    };
    delete stablePlan.plan_hash;
    const planHash = canonicalJsonHash(stablePlan);
    stablePlan.plan_hash = planHash;
    const createdAt = this.timestamp();
    this.database
      .prepare(
        `INSERT INTO plans(plan_hash, environment, created_at, request_json, plan_json)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(plan_hash) DO NOTHING`
      )
      .run(
        planHash,
        this.environment,
        createdAt,
        canonicalJson(request),
        canonicalJson(stablePlan)
      );
    return clone(stablePlan);
  }

  getPlan(planHash) {
    const clean = cleanHash(planHash, 'plan_hash');
    const row = this.database
      .prepare(
        'SELECT plan_json FROM plans WHERE plan_hash = ? AND environment = ?'
      )
      .get(clean, this.environment);
    return row ? parseJson(row.plan_json) : null;
  }

  getPlanRequest(planHash) {
    const clean = cleanHash(planHash, 'plan_hash');
    const row = this.database
      .prepare(
        'SELECT request_json FROM plans WHERE plan_hash = ? AND environment = ?'
      )
      .get(clean, this.environment);
    return row ? parseJson(row.request_json) : null;
  }

  createJob({ planHash, idempotencyKey, request, creditAuthorization = null }) {
    const cleanPlanHash = cleanHash(planHash, 'plan_hash');
    const cleanKey = cleanIdempotencyKey(idempotencyKey);
    const plan = this.getPlan(cleanPlanHash);
    if (!plan) throw new Error(`Unknown plan_hash: ${cleanPlanHash}`);
    const requestPayload = clone(request || {});
    const requestHash = canonicalJsonHash({
      plan_hash: cleanPlanHash,
      request: requestPayload,
      credit_authorization: creditAuthorization,
    });

    return this.transaction(() => {
      const existing = this.database
        .prepare(
          `SELECT request_hash, job_json FROM jobs
           WHERE environment = ? AND idempotency_key = ?`
        )
        .get(this.environment, cleanKey);
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new IdempotencyConflictError(
            'This idempotency_key is already bound to a different plan or credit authorization.'
          );
        }
        return { job: parseJson(existing.job_json), reused: true };
      }

      const now = this.timestamp();
      const jobId = randomUUID();
      const stages = Array.isArray(plan.stages)
        ? plan.stages.map((stage, index) => ({
            id: String(stage.id || `stage_${index + 1}`),
            label: String(stage.label || stage.id || `Stage ${index + 1}`),
            status: 'pending',
            percent: 0,
            operation_id: null,
            started_at: null,
            finished_at: null,
            attempts: 0,
            claim_owner: null,
            recoverable: true,
            result: null,
            error: null,
          }))
        : [];
      const job = {
        schema_version: MCP_V2_SCHEMA_VERSION,
        job_id: jobId,
        environment: this.environment,
        idempotency_key: cleanKey,
        plan_hash: cleanPlanHash,
        status: 'queued',
        stage: stages[0]?.id || 'complete',
        stage_index: stages.length ? 0 : -1,
        percent: stages.length ? 0 : 100,
        human_status: stages.length ? 'Queued' : 'Completed',
        created_at: now,
        updated_at: now,
        started_at: null,
        finished_at: stages.length ? null : now,
        estimated_remaining_seconds:
          plan.estimated_processing_time?.likely_seconds ?? null,
        pause_requested: false,
        cancel_requested: false,
        recoverability: {
          recoverable: true,
          status: stages.length ? 'ready' : 'complete',
          resume_from_stage: stages[0]?.id || null,
        },
        credit_usage: {
          estimated_stage5_credits:
            Number(plan.credit_usage?.total_stage5_credits || 0) || 0,
          authorized_stage5_credits:
            Number(creditAuthorization?.max_stage5_credits || 0) || 0,
          consumed_stage5_credits: 0,
          authorization_kind: 'preflight_estimate_gate',
          authorization_is_hard_cap: false,
          consumption_attribution_authoritative: null,
          measurement: 'authoritative_stage_results_or_observed_balance_delta',
          entries: [],
        },
        source: clone(plan.source || null),
        stages,
        artifacts: [],
        validation: null,
        manifest: null,
        request: requestPayload,
        error: null,
        revision: 1,
        event_cursor: 1,
      };

      this.database
        .prepare(
          `INSERT INTO jobs(
             job_id, environment, idempotency_key, request_hash, plan_hash,
             status, stage, percent, revision, created_at, updated_at,
             finished_at, job_json
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          jobId,
          this.environment,
          cleanKey,
          requestHash,
          cleanPlanHash,
          job.status,
          job.stage,
          job.percent,
          job.revision,
          now,
          now,
          job.finished_at,
          canonicalJson(job)
        );
      this.insertEvent(
        jobId,
        1,
        'job_created',
        job.stage,
        {
          plan_hash: cleanPlanHash,
          idempotency_key: cleanKey,
        },
        now
      );
      return { job: clone(job), reused: false };
    });
  }

  createRenderCheckpointFork({
    sourceJobId,
    sourceJobSha256,
    translationSessionSha256,
    validationSha256,
    creditLedgerSha256,
    preflightDigest,
    idempotencyKey,
    request,
    plan,
    sourceCheckpoint,
  }) {
    const sourceId = String(sourceJobId || '').trim();
    if (!sourceId) throw new TypeError('sourceJobId is required.');
    const expectedSourceJobSha256 = cleanHash(
      sourceJobSha256,
      'source_job_sha256'
    );
    const expectedSessionSha256 = cleanHash(
      translationSessionSha256,
      'translation_session_sha256'
    );
    const expectedValidationSha256 = cleanHash(
      validationSha256,
      'validation_sha256'
    );
    const expectedCreditLedgerSha256 = cleanHash(
      creditLedgerSha256,
      'credit_ledger_sha256'
    );
    const expectedPreflightDigest = cleanHash(
      preflightDigest,
      'preflight_digest'
    );
    const cleanKey = cleanIdempotencyKey(idempotencyKey);
    const stablePlan = stablePlanForEnvironment(
      plan,
      this.environment,
      MCP_V2_SCHEMA_VERSION
    );
    const requestPayload = clone(request || {});
    const requestHash = canonicalJsonHash({
      kind: 'render_checkpoint_fork',
      source_job_id: sourceId,
      plan_hash: stablePlan.plan_hash,
      preflight_digest: expectedPreflightDigest,
      request: requestPayload,
    });

    return this.transaction(() => {
      const sourceJob = this.requireJob(sourceId);
      const sourceSession = this.getTranslationSession(sourceId);
      const sourcePlan = this.getPlan(sourceJob.plan_hash);
      if (sourceJob.status !== 'cancelled') {
        throw new IdempotencyConflictError(
          'The render-checkpoint source job is no longer cancelled.'
        );
      }
      if (!sourceSession) {
        throw new IdempotencyConflictError(
          'The render-checkpoint source translation session is unavailable.'
        );
      }
      if (!sourcePlan) {
        throw new IdempotencyConflictError(
          'The render-checkpoint source plan is unavailable.'
        );
      }
      if (this.getJobActivityClaim(sourceId)) {
        throw new IdempotencyConflictError(
          'The render-checkpoint source job has active work.'
        );
      }
      if (
        persistentJobCheckpointSha256(sourceJob) !== expectedSourceJobSha256
      ) {
        throw new IdempotencyConflictError(
          'The canceled source job changed after render recovery preflight.'
        );
      }
      if (
        translationSessionCheckpointSha256(sourceSession) !==
        expectedSessionSha256
      ) {
        throw new IdempotencyConflictError(
          'The accepted translation checkpoint changed after preflight.'
        );
      }
      if (
        validationCheckpointSha256(sourceJob.validation) !==
        expectedValidationSha256
      ) {
        throw new IdempotencyConflictError(
          'The completed validation checkpoint changed after preflight.'
        );
      }
      if (
        creditLedgerCheckpointSha256(sourceJob.credit_usage) !==
        expectedCreditLedgerSha256
      ) {
        throw new IdempotencyConflictError(
          'The source credit ledger changed after preflight.'
        );
      }
      const validationStage = sourceJob.stages?.find(
        stage => stage?.id === 'translation_validation'
      );
      if (
        validationStage?.status !== 'completed' ||
        sourceJob.validation?.passed !== true ||
        validationCheckpointSha256(validationStage.result) !==
          expectedValidationSha256
      ) {
        throw new IdempotencyConflictError(
          'The source validation checkpoint is no longer completed and passing.'
        );
      }
      if (!hasRecoverableRenderCheckpoint(sourceJob)) {
        throw new IdempotencyConflictError(
          'The source render checkpoint is no longer unstarted or durably cancelled without rendered artifacts.'
        );
      }
      if (
        !Array.isArray(sourceSession.segments) ||
        sourceSession.segments.length === 0 ||
        !sourceSession.segments.every(
          segment =>
            String(segment?.translation || '').trim() &&
            ['translated', 'reviewed'].includes(String(segment?.status || ''))
        )
      ) {
        throw new IdempotencyConflictError(
          'The source translation checkpoint is no longer fully accepted.'
        );
      }
      if (
        stablePlan.recovery?.source_job_id !== sourceId ||
        stablePlan.recovery?.source_job_sha256 !== expectedSourceJobSha256 ||
        stablePlan.recovery?.translation_session_sha256 !==
          expectedSessionSha256 ||
        stablePlan.recovery?.validation_sha256 !== expectedValidationSha256 ||
        stablePlan.recovery?.inherited_credit_ledger?.ledger_sha256 !==
          expectedCreditLedgerSha256
      ) {
        throw new IdempotencyConflictError(
          'The candidate fork plan is not bound to the exact preflight checkpoints.'
        );
      }
      if (
        canonicalJson(stablePlan.stages) !==
          canonicalJson(RENDER_CHECKPOINT_FORK_STAGES) ||
        Number(stablePlan.credit_usage?.total_stage5_credits) !== 0
      ) {
        throw new IdempotencyConflictError(
          'The candidate fork contains a non-render stage or credit estimate.'
        );
      }
      if (
        stablePlan.recovery?.source_checkpoint?.sha256 !==
          sourceCheckpoint?.sha256 ||
        Number(stablePlan.recovery?.source_checkpoint?.bytes) !==
          Number(sourceCheckpoint?.bytes) ||
        normalizedStoredPathIdentity(
          stablePlan.recovery?.source_checkpoint?.path
        ) !== normalizedStoredPathIdentity(sourceCheckpoint?.path)
      ) {
        throw new IdempotencyConflictError(
          'The candidate fork source checkpoint does not match preflight.'
        );
      }
      const checkpointPath = normalizedStoredPathIdentity(
        sourceCheckpoint?.path
      );
      const checkpointSha256 = cleanHash(
        sourceCheckpoint?.sha256,
        'source_checkpoint.sha256'
      );
      const checkpointBytes = Number(sourceCheckpoint?.bytes);
      const authoritativeSources = [
        {
          path: sourcePlan.source?.path,
          sha256: sourcePlan.source?.sha256,
          bytes: sourcePlan.source?.bytes,
        },
        ...(sourceJob.artifacts || []).map(artifact => ({
          path: artifact?.path,
          sha256: artifact?.checkpoint_sha256 || artifact?.sha256,
          bytes: artifact?.checkpoint_bytes ?? artifact?.bytes,
        })),
      ];
      if (
        !checkpointPath ||
        !Number.isSafeInteger(checkpointBytes) ||
        checkpointBytes <= 0 ||
        !authoritativeSources.some(
          candidate =>
            normalizedStoredPathIdentity(candidate.path) === checkpointPath &&
            String(candidate.sha256 || '').toLowerCase() === checkpointSha256 &&
            Number(candidate.bytes) === checkpointBytes
        )
      ) {
        throw new IdempotencyConflictError(
          'The recovery source checkpoint is not bound to the canceled source job.'
        );
      }
      const rebuiltPlan = stablePlanForEnvironment(
        buildRenderCheckpointForkPlan({
          sourcePlan,
          sourceJobId: sourceId,
          sourceJobSha256: expectedSourceJobSha256,
          sourceCheckpoint,
          translationSessionSha256: expectedSessionSha256,
          validationSha256: expectedValidationSha256,
          creditLedgerSha256: expectedCreditLedgerSha256,
          renderOverride: requestPayload.render_override,
        }),
        this.environment,
        MCP_V2_SCHEMA_VERSION
      );
      if (rebuiltPlan.plan_hash !== stablePlan.plan_hash) {
        throw new IdempotencyConflictError(
          'The candidate fork plan is not the deterministic render-only derivative of the source plan.'
        );
      }

      const existing = this.database
        .prepare(
          `SELECT request_hash, job_json FROM jobs
           WHERE environment = ? AND idempotency_key = ?`
        )
        .get(this.environment, cleanKey);
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new IdempotencyConflictError(
            'This idempotency_key is already bound to a different render-checkpoint fork.'
          );
        }
        return {
          job: parseJson(existing.job_json),
          plan: stablePlan,
          reused: true,
        };
      }
      const duplicateFork = this.database
        .prepare(
          `SELECT job_json FROM jobs
           WHERE environment = ? ORDER BY created_at DESC`
        )
        .all(this.environment)
        .map(row => parseJson(row.job_json))
        .find(
          candidate =>
            candidate?.recovery?.preflight_digest === expectedPreflightDigest
        );
      if (duplicateFork) {
        throw new IdempotencyConflictError(
          `This render-checkpoint preflight already created fork ${duplicateFork.job_id}; reuse its original idempotency_key.`
        );
      }

      const now = this.timestamp();
      this.database
        .prepare(
          `INSERT INTO plans(plan_hash, environment, created_at, request_json, plan_json)
           VALUES(?, ?, ?, ?, ?)
           ON CONFLICT(plan_hash) DO NOTHING`
        )
        .run(
          stablePlan.plan_hash,
          this.environment,
          now,
          canonicalJson(requestPayload),
          canonicalJson(stablePlan)
        );

      const jobId = randomUUID();
      const stages = RENDER_CHECKPOINT_FORK_STAGES.map((stage, index) => ({
        id: stage.id,
        label: stage.label,
        status: index === 0 ? 'blocked' : 'pending',
        percent: 0,
        operation_id: null,
        started_at: null,
        finished_at: null,
        attempts: 0,
        claim_owner: null,
        recoverable: true,
        result: null,
        error:
          index === 0
            ? {
                code: 'RENDER_AUTHORIZATION_REQUIRED',
                message:
                  'Render-only recovery fork is ready. Explicitly authorize render_outputs before encoding.',
                recoverable: true,
                suggested_action: 'render_outputs',
              }
            : null,
      }));
      const sourceArtifact = {
        path: String(sourceCheckpoint?.path || ''),
        stage: String(sourceCheckpoint?.stage || 'recovery_source'),
        kind: sourceCheckpoint?.kind || 'video',
        checkpoint_sha256: String(sourceCheckpoint?.sha256 || ''),
        checkpoint_bytes: Number(sourceCheckpoint?.bytes),
        checkpoint_captured_at: sourceCheckpoint?.checkpoint_captured_at || now,
        verified: false,
        inherited_from_job_id: sourceId,
      };
      const job = {
        schema_version: MCP_V2_SCHEMA_VERSION,
        job_id: jobId,
        environment: this.environment,
        idempotency_key: cleanKey,
        plan_hash: stablePlan.plan_hash,
        status: 'blocked',
        stage: 'render_outputs',
        stage_index: 0,
        percent: 0,
        human_status:
          'Render-only recovery fork ready; explicit render approval required',
        created_at: now,
        updated_at: now,
        started_at: null,
        finished_at: null,
        estimated_remaining_seconds:
          stablePlan.estimated_processing_time?.likely_seconds ?? null,
        pause_requested: false,
        cancel_requested: false,
        recoverability: {
          recoverable: true,
          status: 'render_authorization_required',
          resume_from_stage: 'render_outputs',
        },
        credit_usage: {
          estimated_stage5_credits: 0,
          authorized_stage5_credits: 0,
          consumed_stage5_credits: 0,
          authorization_kind: 'render_checkpoint_fork_no_credit',
          authorization_is_hard_cap: true,
          consumption_attribution_authoritative: true,
          measurement: 'no_credit_bearing_stages',
          entries: [],
          inherited_ledger: {
            source_job_id: sourceId,
            ledger_sha256: expectedCreditLedgerSha256,
            snapshot: clone(sourceJob.credit_usage || {}),
          },
        },
        source: clone(stablePlan.source || null),
        stages,
        artifacts: [sourceArtifact],
        validation: clone(sourceJob.validation),
        manifest: null,
        request: requestPayload,
        recovery: {
          ...clone(stablePlan.recovery),
          preflight_digest: expectedPreflightDigest,
        },
        render_authorized: false,
        render_warnings_authorized: false,
        error: clone(stages[0].error),
        revision: 1,
        event_cursor: 1,
      };
      this.database
        .prepare(
          `INSERT INTO jobs(
             job_id, environment, idempotency_key, request_hash, plan_hash,
             status, stage, percent, revision, created_at, updated_at,
             finished_at, job_json
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          jobId,
          this.environment,
          cleanKey,
          requestHash,
          stablePlan.plan_hash,
          job.status,
          job.stage,
          job.percent,
          job.revision,
          now,
          now,
          null,
          canonicalJson(job)
        );

      const forkSession = {
        ...clone(sourceSession),
        job_id: jobId,
        created_at: now,
        updated_at: now,
        revision: 1,
      };
      this.database
        .prepare(
          `INSERT INTO translation_sessions(
             job_id, source_hash, revision, created_at, updated_at, session_json
           ) VALUES(?, ?, ?, ?, ?, ?)`
        )
        .run(
          jobId,
          forkSession.source_hash,
          forkSession.revision,
          now,
          now,
          canonicalJson(forkSession)
        );
      this.insertEvent(
        jobId,
        1,
        'render_checkpoint_fork_created',
        job.stage,
        {
          source_job_id: sourceId,
          source_job_sha256: expectedSourceJobSha256,
          translation_session_sha256: expectedSessionSha256,
          validation_sha256: expectedValidationSha256,
          credit_ledger_sha256: expectedCreditLedgerSha256,
          preflight_digest: expectedPreflightDigest,
          render_authorized: false,
        },
        now
      );
      const sourceKey = String(stablePlan.source?.source_key || '').trim();
      if (sourceKey) {
        this.database
          .prepare(
            `INSERT INTO source_records(
               environment, source_key, job_id, updated_at, data_json
             ) VALUES(?, ?, ?, ?, ?)
             ON CONFLICT(environment, source_key, job_id) DO UPDATE SET
               updated_at = excluded.updated_at,
               data_json = excluded.data_json`
          )
          .run(
            this.environment,
            sourceKey,
            jobId,
            now,
            canonicalJson({
              plan_hash: stablePlan.plan_hash,
              status: job.status,
              stage: job.stage,
              recovery_source_job_id: sourceId,
            })
          );
      }
      return { job: clone(job), plan: clone(stablePlan), reused: false };
    });
  }

  getJobByIdempotencyKey(idempotencyKey) {
    const cleanKey = cleanIdempotencyKey(idempotencyKey);
    const row = this.database
      .prepare(
        `SELECT job_json FROM jobs
         WHERE environment = ? AND idempotency_key = ?`
      )
      .get(this.environment, cleanKey);
    return row ? parseJson(row.job_json) : null;
  }

  claimControlRequest(jobId, controlKeyValue) {
    this.requireJob(jobId);
    const controlKey = String(controlKeyValue || '').trim();
    if (
      !controlKey ||
      controlKey.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(controlKey)
    ) {
      throw new TypeError('Invalid job control key.');
    }
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO job_control_requests(job_id, control_key, created_at)
         VALUES(?, ?, ?)`
      )
      .run(jobId, controlKey, this.timestamp());
    return Number(result.changes) === 1;
  }

  releaseControlRequest(jobId, controlKeyValue) {
    const controlKey = String(controlKeyValue || '').trim();
    if (!controlKey) return false;
    const result = this.database
      .prepare(
        'DELETE FROM job_control_requests WHERE job_id = ? AND control_key = ?'
      )
      .run(jobId, controlKey);
    return Number(result.changes) === 1;
  }

  claimJobActivity(jobId, activityKindValue, activityTokenValue, ownerValue) {
    this.requireJob(jobId);
    const activityKind = cleanActivityKind(activityKindValue);
    const activityToken = cleanActivityToken(activityTokenValue);
    const owner = cleanClaimOwner(ownerValue);
    const ownerJson = canonicalJson(owner);
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO job_activity_claims(
           job_id, activity_kind, activity_token, owner_json, created_at
         ) VALUES(?, ?, ?, ?, ?)`
      )
      .run(jobId, activityKind, activityToken, ownerJson, this.timestamp());
    if (Number(result.changes) === 1) {
      return {
        claimed: true,
        reused: false,
        activity_kind: activityKind,
        activity_token: activityToken,
        owner,
      };
    }
    const current = this.getJobActivityClaim(jobId);
    return {
      claimed:
        current?.activity_kind === activityKind &&
        current?.activity_token === activityToken &&
        canonicalJson(current.owner) === ownerJson,
      reused: true,
      activity_kind: current?.activity_kind || null,
      activity_token: current?.activity_token || null,
      owner: current?.owner || null,
    };
  }

  replaceJobActivityClaim(
    jobId,
    expectedActivityKindValue,
    expectedActivityTokenValue,
    expectedOwnerValue,
    nextActivityKindValue,
    nextActivityTokenValue,
    nextOwnerValue
  ) {
    this.requireJob(jobId);
    const expectedActivityKind = cleanActivityKind(expectedActivityKindValue);
    const expectedActivityToken = cleanActivityToken(
      expectedActivityTokenValue
    );
    const expectedOwner = cleanClaimOwner(expectedOwnerValue);
    const nextActivityKind = cleanActivityKind(nextActivityKindValue);
    const nextActivityToken = cleanActivityToken(nextActivityTokenValue);
    const nextOwner = cleanClaimOwner(nextOwnerValue);
    const result = this.database
      .prepare(
        `UPDATE job_activity_claims
         SET activity_kind = ?, activity_token = ?, owner_json = ?, created_at = ?
         WHERE job_id = ? AND activity_kind = ? AND activity_token = ? AND owner_json = ?`
      )
      .run(
        nextActivityKind,
        nextActivityToken,
        canonicalJson(nextOwner),
        this.timestamp(),
        jobId,
        expectedActivityKind,
        expectedActivityToken,
        canonicalJson(expectedOwner)
      );
    return Number(result.changes) === 1;
  }

  getJobActivityClaim(jobId) {
    this.requireJob(jobId);
    const row = this.database
      .prepare(
        `SELECT activity_kind, activity_token, owner_json, created_at
         FROM job_activity_claims WHERE job_id = ?`
      )
      .get(jobId);
    return row
      ? {
          activity_kind: row.activity_kind,
          activity_token: row.activity_token,
          owner: parseJson(row.owner_json),
          created_at: row.created_at,
        }
      : null;
  }

  releaseJobActivity(jobId, activityKindValue, activityTokenValue, ownerValue) {
    const activityKind = cleanActivityKind(activityKindValue);
    const activityToken = cleanActivityToken(activityTokenValue);
    const owner = cleanClaimOwner(ownerValue);
    const result = this.database
      .prepare(
        `DELETE FROM job_activity_claims
         WHERE job_id = ? AND activity_kind = ? AND activity_token = ? AND owner_json = ?`
      )
      .run(jobId, activityKind, activityToken, canonicalJson(owner));
    return Number(result.changes) === 1;
  }

  insertEvent(
    jobId,
    sequence,
    eventType,
    stage,
    data,
    createdAt = this.timestamp()
  ) {
    this.database
      .prepare(
        `INSERT INTO job_events(job_id, sequence, created_at, event_type, stage, data_json)
         VALUES(?, ?, ?, ?, ?, ?)`
      )
      .run(
        jobId,
        sequence,
        createdAt,
        String(eventType || 'updated'),
        stage == null ? null : String(stage),
        canonicalJson(data || {})
      );
  }

  getJob(jobId) {
    const id = String(jobId || '').trim();
    const row = this.database
      .prepare('SELECT job_json FROM jobs WHERE job_id = ? AND environment = ?')
      .get(id, this.environment);
    return row ? parseJson(row.job_json) : null;
  }

  requireJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Persistent job not found: ${jobId}`);
    return job;
  }

  mutateJob(
    jobId,
    mutate,
    {
      eventType = 'job_updated',
      eventData,
      expectedStage = null,
      allowFailedExpectedStage = false,
    } = {}
  ) {
    if (typeof mutate !== 'function')
      throw new TypeError('mutate must be a function.');
    return this.transaction(() => {
      const current = this.requireJob(jobId);
      if (expectedStage) {
        const stage = current.stages?.[Number(current.stage_index)];
        if (
          ['completed', 'cancelled'].includes(current.status) ||
          (current.status === 'failed' && !allowFailedExpectedStage) ||
          !stage ||
          stage.id !== expectedStage.id ||
          stage.operation_id !== expectedStage.operation_id ||
          Number(stage.attempts || 0) !== Number(expectedStage.attempts || 0) ||
          (expectedStage.status !== undefined &&
            stage.status !== expectedStage.status)
        ) {
          return clone(current);
        }
      }
      const candidate = mutate(clone(current));
      const next = candidate === undefined ? current : candidate;
      if (!isObject(next))
        throw new TypeError('Job mutation must return an object.');
      if (!VALID_JOB_STATUSES.has(next.status)) {
        throw new TypeError(`Invalid persistent job status: ${next.status}`);
      }
      const now = this.timestamp();
      next.job_id = current.job_id;
      next.environment = current.environment;
      next.idempotency_key = current.idempotency_key;
      next.plan_hash = current.plan_hash;
      next.created_at = current.created_at;
      next.updated_at = now;
      next.revision = Number(current.revision || 0) + 1;
      next.event_cursor = Number(current.event_cursor || 0) + 1;
      if (TERMINAL_JOB_STATUSES.has(next.status) && !next.finished_at) {
        next.finished_at = now;
      }
      if (!TERMINAL_JOB_STATUSES.has(next.status)) next.finished_at = null;

      this.database
        .prepare(
          `UPDATE jobs SET status = ?, stage = ?, percent = ?, revision = ?,
             updated_at = ?, finished_at = ?, job_json = ?
           WHERE job_id = ? AND environment = ?`
        )
        .run(
          next.status,
          String(next.stage || ''),
          Number(next.percent || 0),
          next.revision,
          now,
          next.finished_at,
          canonicalJson(next),
          next.job_id,
          this.environment
        );
      this.insertEvent(
        next.job_id,
        next.event_cursor,
        typeof eventType === 'function' ? eventType(next, current) : eventType,
        next.stage,
        eventData === undefined
          ? { status: next.status, percent: next.percent }
          : eventData,
        now
      );
      return clone(next);
    });
  }

  claimCurrentStage(jobId, operationId, claimOwner = null) {
    const cleanOperationId = String(operationId || '').trim();
    if (!cleanOperationId) throw new TypeError('operationId is required.');
    return this.transaction(() => {
      const current = this.requireJob(jobId);
      const index = Number(current.stage_index);
      const currentStage = current.stages?.[index];
      if (
        !currentStage ||
        !['pending', 'retrying', 'interrupted'].includes(currentStage.status) ||
        !['queued', 'starting', 'blocked', 'paused'].includes(current.status)
      ) {
        return { claimed: false, job: current };
      }
      const now = this.timestamp();
      currentStage.status = 'starting';
      currentStage.operation_id = currentStage.operation_id || cleanOperationId;
      currentStage.claim_owner = clone(claimOwner);
      currentStage.started_at = currentStage.started_at || now;
      currentStage.finished_at = null;
      currentStage.attempts = Number(currentStage.attempts || 0) + 1;
      currentStage.error = null;
      current.status = 'starting';
      current.stage = currentStage.id;
      current.human_status = `Starting ${currentStage.label}`;
      current.started_at = current.started_at || now;
      current.updated_at = now;
      current.revision = Number(current.revision || 0) + 1;
      current.event_cursor = Number(current.event_cursor || 0) + 1;
      current.finished_at = null;
      this.database
        .prepare(
          `UPDATE jobs SET status = ?, stage = ?, percent = ?, revision = ?,
             updated_at = ?, finished_at = ?, job_json = ?
           WHERE job_id = ? AND environment = ?`
        )
        .run(
          current.status,
          current.stage,
          Number(current.percent || 0),
          current.revision,
          now,
          null,
          canonicalJson(current),
          current.job_id,
          this.environment
        );
      this.insertEvent(
        current.job_id,
        current.event_cursor,
        'stage_claimed',
        current.stage,
        {
          operation_id: currentStage.operation_id,
          attempt: currentStage.attempts,
        },
        now
      );
      return { claimed: true, job: clone(current) };
    });
  }

  getEvents(jobId, afterCursor = 0, limit = 100) {
    this.requireJob(jobId);
    const cursor = Math.max(0, Number(afterCursor) || 0);
    const boundedLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    return this.database
      .prepare(
        `SELECT sequence, created_at, event_type, stage, data_json
         FROM job_events
         WHERE job_id = ? AND sequence > ?
         ORDER BY sequence ASC LIMIT ?`
      )
      .all(jobId, cursor, boundedLimit)
      .map(row => ({
        cursor: Number(row.sequence),
        created_at: row.created_at,
        type: row.event_type,
        stage: row.stage,
        data: parseJson(row.data_json, {}),
      }));
  }

  listJobs({ status, limit = 25 } = {}) {
    if (status !== undefined && !VALID_JOB_STATUSES.has(status)) {
      throw new TypeError(`Invalid persistent job status: ${status}`);
    }
    const boundedLimit = Math.min(100, Math.max(1, Number(limit) || 25));
    const rows = status
      ? this.database
          .prepare(
            `SELECT job_json FROM jobs
             WHERE environment = ? AND status = ?
             ORDER BY updated_at DESC LIMIT ?`
          )
          .all(this.environment, status, boundedLimit)
      : this.database
          .prepare(
            `SELECT job_json FROM jobs
             WHERE environment = ? ORDER BY updated_at DESC LIMIT ?`
          )
          .all(this.environment, boundedLimit);
    return rows.map(row => parseJson(row.job_json));
  }

  saveProfile(nameValue, profile) {
    const name = cleanProfileName(nameValue);
    if (!isObject(profile)) throw new TypeError('profile must be an object.');
    assertCredentialFree(profile);
    assertProfileShape(profile);
    const mergedPublicProfile = mergeJsonObjects(
      BUILTIN_PROJECT_PROFILES[name] || {},
      profile
    );
    for (const internalKey of [
      'name',
      'revision',
      'updated_at',
      'builtin_base',
    ]) {
      delete mergedPublicProfile[internalKey];
    }
    // A partial override can be valid on its own while exceeding a bound once
    // it is combined with a built-in profile. Validate the exact public shape
    // that callers will later receive and use for immutable plans.
    assertProfileShape(mergedPublicProfile);
    const now = this.timestamp();
    return this.transaction(() => {
      const current = this.database
        .prepare(
          'SELECT revision FROM profiles WHERE environment = ? AND name = ?'
        )
        .get(this.environment, name);
      const revision = Number(current?.revision || 0) + 1;
      const stored = {
        ...mergedPublicProfile,
        name,
        revision,
        updated_at: now,
        builtin_base: Object.hasOwn(BUILTIN_PROJECT_PROFILES, name)
          ? name
          : null,
      };
      if (Buffer.byteLength(canonicalJson(stored)) > 256 * 1024) {
        throw new TypeError('Project profiles cannot exceed 256 KiB.');
      }
      this.database
        .prepare(
          `INSERT INTO profiles(environment, name, revision, updated_at, profile_json)
           VALUES(?, ?, ?, ?, ?)
           ON CONFLICT(environment, name) DO UPDATE SET
             revision = excluded.revision,
             updated_at = excluded.updated_at,
             profile_json = excluded.profile_json`
        )
        .run(this.environment, name, revision, now, canonicalJson(stored));
      return clone(stored);
    });
  }

  getProfile(nameValue) {
    const name = cleanProfileName(nameValue);
    const row = this.database
      .prepare(
        'SELECT profile_json FROM profiles WHERE environment = ? AND name = ?'
      )
      .get(this.environment, name);
    if (row) return parseJson(row.profile_json);
    return Object.hasOwn(BUILTIN_PROJECT_PROFILES, name)
      ? clone(BUILTIN_PROJECT_PROFILES[name])
      : null;
  }

  recordSource(jobId, sourceKey, data = {}) {
    this.requireJob(jobId);
    const key = String(sourceKey || '').trim();
    if (!key || key.length > 1024) throw new TypeError('Invalid source key.');
    const now = this.timestamp();
    this.database
      .prepare(
        `INSERT INTO source_records(environment, source_key, job_id, updated_at, data_json)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(environment, source_key, job_id) DO UPDATE SET
           updated_at = excluded.updated_at,
           data_json = excluded.data_json`
      )
      .run(this.environment, key, jobId, now, canonicalJson(data));
  }

  findSourceRecords(sourceKey, limit = 20) {
    const key = String(sourceKey || '').trim();
    if (!key) return [];
    return this.database
      .prepare(
        `SELECT job_id, updated_at, data_json FROM source_records
         WHERE environment = ? AND source_key = ?
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(
        this.environment,
        key,
        Math.min(100, Math.max(1, Number(limit) || 20))
      )
      .map(row => ({
        job_id: row.job_id,
        updated_at: row.updated_at,
        data: parseJson(row.data_json, {}),
      }));
  }

  initializeTranslationSession(
    jobId,
    {
      segments,
      sourceLanguage = 'auto',
      targetLanguage,
      profileName = null,
      glossary = {},
      mediaDurationSeconds = null,
    }
  ) {
    this.requireJob(jobId);
    const target = String(targetLanguage || '').trim();
    if (target.length < 2 || target.length > 80 || /[\p{Cc}]/u.test(target)) {
      throw new TypeError(
        'targetLanguage must contain between 2 and 80 printable characters.'
      );
    }
    const source = String(sourceLanguage || 'auto').trim() || 'auto';
    if (source.length > 80 || /[\p{Cc}]/u.test(source)) {
      throw new TypeError(
        'sourceLanguage must contain at most 80 printable characters.'
      );
    }
    const normalizedProfileName =
      profileName == null ? null : cleanProfileName(profileName);
    assertProfileShape({ glossary });
    if (!Array.isArray(segments) || segments.length === 0) {
      throw new TypeError('Translation session requires at least one segment.');
    }
    if (segments.length > MAX_TRANSLATION_SESSION_SEGMENTS) {
      throw new TypeError(
        `Translation session cannot exceed ${MAX_TRANSLATION_SESSION_SEGMENTS} segments.`
      );
    }
    const ids = new Set();
    const normalizedSegments = segments.map((segment, offset) => {
      const id = String(
        segment?.id || `seg_${String(offset + 1).padStart(5, '0')}`
      ).trim();
      if (!id || ids.has(id))
        throw new TypeError(`Invalid or duplicate segment id: ${id}`);
      if (id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) {
        throw new TypeError(
          `Translation segment id must contain at most 200 printable characters: ${id.slice(0, 40)}`
        );
      }
      ids.add(id);
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start
      ) {
        throw new TypeError(`Invalid timing for segment: ${id}`);
      }
      const source = String(segment?.source ?? segment?.original ?? '').trim();
      if (!source)
        throw new TypeError(`Source text is empty for segment: ${id}`);
      if (source.length > MAX_TRANSLATION_SEGMENT_TEXT_CHARACTERS) {
        throw new TypeError(
          `Source text exceeds ${MAX_TRANSLATION_SEGMENT_TEXT_CHARACTERS} characters: ${id}`
        );
      }
      const translation = String(segment?.translation || '').trim();
      if (translation.length > MAX_TRANSLATION_SEGMENT_TEXT_CHARACTERS) {
        throw new TypeError(
          `Translation exceeds ${MAX_TRANSLATION_SEGMENT_TEXT_CHARACTERS} characters: ${id}`
        );
      }
      const requestedStatus = translation
        ? String(segment?.status || 'translated')
        : 'pending';
      const status = VALID_TRANSLATION_SEGMENT_STATUSES.has(requestedStatus)
        ? requestedStatus
        : translation
          ? 'translated'
          : 'pending';
      const speaker = String(segment?.speaker || '').trim();
      const topic = String(segment?.topic || '').trim();
      if (speaker.length > 500 || topic.length > 500) {
        throw new TypeError(
          `Translation speaker/topic context exceeds 500 characters: ${id}`
        );
      }
      return {
        id,
        index: Number.isSafeInteger(segment?.index)
          ? segment.index
          : offset + 1,
        start,
        end,
        start_ms: Math.round(start * 1000),
        end_ms: Math.round(end * 1000),
        source,
        translation,
        status,
        revision_count: Math.max(
          0,
          Number(segment?.revision_count ?? segment?.revisionCount) || 0
        ),
        speaker: speaker || null,
        topic: topic || null,
      };
    });
    const sourceHash = canonicalJsonHash(
      normalizedSegments.map(({ id, start_ms, end_ms, source }) => ({
        id,
        start_ms,
        end_ms,
        source,
      }))
    );
    assertBoundedTranslationSessionText(normalizedSegments);

    return this.transaction(() => {
      const existing = this.database
        .prepare(
          'SELECT source_hash, session_json FROM translation_sessions WHERE job_id = ?'
        )
        .get(jobId);
      if (existing) {
        if (existing.source_hash !== sourceHash) {
          throw new IdempotencyConflictError(
            'This job already has a translation session for different source segments.'
          );
        }
        return { session: parseJson(existing.session_json), reused: true };
      }
      const now = this.timestamp();
      const session = {
        schema_version: MCP_V2_SCHEMA_VERSION,
        job_id: jobId,
        source_hash: sourceHash,
        source_language: source,
        target_language: target,
        project_profile: normalizedProfileName,
        glossary: clone(glossary || {}),
        media_duration_seconds:
          Number.isFinite(Number(mediaDurationSeconds)) &&
          Number(mediaDurationSeconds) > 0
            ? Number(mediaDurationSeconds)
            : null,
        segments: normalizedSegments,
        created_at: now,
        updated_at: now,
        revision: 1,
      };
      this.database
        .prepare(
          `INSERT INTO translation_sessions(
             job_id, source_hash, revision, created_at, updated_at, session_json
           ) VALUES(?, ?, ?, ?, ?, ?)`
        )
        .run(jobId, sourceHash, 1, now, now, canonicalJson(session));
      return { session: clone(session), reused: false };
    });
  }

  getTranslationSession(jobId) {
    this.requireJob(jobId);
    const row = this.database
      .prepare('SELECT session_json FROM translation_sessions WHERE job_id = ?')
      .get(jobId);
    return row ? parseJson(row.session_json) : null;
  }

  synchronizeTranslationSession(jobId, segments) {
    if (!Array.isArray(segments) || !segments.length) {
      throw new TypeError('segments must contain at least one subtitle cue.');
    }
    return this.transaction(() => {
      const row = this.database
        .prepare(
          'SELECT session_json FROM translation_sessions WHERE job_id = ?'
        )
        .get(jobId);
      if (!row)
        throw new Error(`Translation session not found for job: ${jobId}`);
      const session = parseJson(row.session_json);
      const incoming = new Map(
        segments.map(segment => [String(segment?.id || '').trim(), segment])
      );
      if (
        incoming.size !== segments.length ||
        incoming.size !== session.segments.length ||
        incoming.has('')
      ) {
        throw new IdempotencyConflictError(
          'App subtitle cues no longer match the persistent translation session.'
        );
      }
      for (const persistent of session.segments) {
        const next = incoming.get(persistent.id);
        if (
          !next ||
          Math.abs(Number(next.start) - persistent.start) > 0.001 ||
          Math.abs(Number(next.end) - persistent.end) > 0.001 ||
          String(next.source ?? next.original ?? '').trim() !==
            persistent.source
        ) {
          throw new IdempotencyConflictError(
            `App subtitle cue changed outside the persistent job: ${persistent.id}`
          );
        }
        const translation = String(next.translation || '').trim();
        if (translation.length > MAX_TRANSLATION_SEGMENT_TEXT_CHARACTERS) {
          throw new TypeError(
            `Translation exceeds ${MAX_TRANSLATION_SEGMENT_TEXT_CHARACTERS} characters: ${persistent.id}`
          );
        }
        if (persistent.translation && persistent.translation !== translation) {
          persistent.revision_count =
            Number(persistent.revision_count || 0) + 1;
        }
        persistent.translation = translation;
        const requestedStatus = translation
          ? String(next.status || 'translated')
          : 'pending';
        persistent.status = VALID_TRANSLATION_SEGMENT_STATUSES.has(
          requestedStatus
        )
          ? requestedStatus
          : translation
            ? 'translated'
            : 'pending';
      }
      assertBoundedTranslationSessionText(session.segments);
      const now = this.timestamp();
      session.updated_at = now;
      session.revision = Number(session.revision || 0) + 1;
      this.database
        .prepare(
          `UPDATE translation_sessions SET revision = ?, updated_at = ?, session_json = ?
           WHERE job_id = ?`
        )
        .run(session.revision, now, canonicalJson(session), jobId);
      return clone(session);
    });
  }

  summarizeTranslationSession(session) {
    const translated = session.segments.filter(segment =>
      String(segment.translation || '').trim()
    ).length;
    const reviewed = session.segments.filter(
      segment => segment.status === 'reviewed'
    ).length;
    const needsCorrection = session.segments.filter(
      segment => segment.status === 'needs_correction'
    ).length;
    return {
      job_id: session.job_id,
      source_language: session.source_language,
      target_language: session.target_language,
      total_segments: session.segments.length,
      translated_segments: translated,
      reviewed_segments: reviewed,
      needs_correction_segments: needsCorrection,
      pending_segments: session.segments.length - translated,
      percent_translated: Math.round(
        (translated / session.segments.length) * 100
      ),
      revision: session.revision,
      updated_at: session.updated_at,
    };
  }

  issueTranslationBatch(jobId, { mode = 'translate', maxSegments = 16 } = {}) {
    if (!['translate', 'review'].includes(mode)) {
      throw new TypeError('mode must be translate or review.');
    }
    const boundedMax = Math.min(40, Math.max(1, Number(maxSegments) || 16));
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const stage = job.stages?.[Number(job.stage_index)];
      const correctionReview =
        mode === 'review' &&
        stage?.id === 'translation_validation' &&
        job.status === 'blocked' &&
        job.error?.code === 'TRANSLATION_VALIDATION_FAILED';
      if (
        !(
          (mode === 'translate' &&
            stage?.id === 'translation_external' &&
            job.status === 'waiting_for_agent') ||
          correctionReview
        )
      ) {
        throw new Error(
          'This job is not atomically waiting for this translation batch mode.'
        );
      }
      const sessionRow = this.database
        .prepare(
          'SELECT session_json FROM translation_sessions WHERE job_id = ?'
        )
        .get(jobId);
      if (!sessionRow)
        throw new Error(`Translation session not found for job: ${jobId}`);
      const session = parseJson(sessionRow.session_json);
      const hasCorrectionTargets = session.segments.some(
        segment => segment.status === 'needs_correction'
      );
      const eligible = session.segments
        .map((segment, index) => ({ segment, index }))
        .filter(({ segment }) =>
          mode === 'review'
            ? hasCorrectionTargets
              ? segment.status === 'needs_correction'
              : Boolean(String(segment.translation || '').trim()) &&
                segment.status !== 'reviewed'
            : !String(segment.translation || '').trim()
        );
      if (!eligible.length) {
        return {
          batch_id: null,
          mode,
          complete: true,
          session: this.summarizeTranslationSession(session),
          segments: [],
        };
      }

      let selected = eligible.slice(0, boundedMax);
      if (eligible.length > boundedMax && selected.length >= 3) {
        const minimumBoundaryOffset = Math.max(
          1,
          Math.floor(selected.length * 0.55)
        );
        for (
          let offset = selected.length - 1;
          offset >= minimumBoundaryOffset;
          offset -= 1
        ) {
          const current = selected[offset];
          const next = session.segments[current.index + 1] || null;
          if (isSemanticBoundary(current.segment, next)) {
            selected = selected.slice(0, offset + 1);
            break;
          }
        }
      }

      const selection = {
        segment_ids: selected.map(item => item.segment.id),
        fingerprint: canonicalJsonHash(
          selected.map(({ segment }) => ({
            id: segment.id,
            start_ms: segment.start_ms,
            end_ms: segment.end_ms,
            source: segment.source,
            translation: segment.translation,
            status: segment.status,
          }))
        ),
      };

      const existing = this.database
        .prepare(
          `SELECT batch_id, created_at, selection_json FROM translation_batches
           WHERE job_id = ? AND mode = ? AND accepted_at IS NULL
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(jobId, mode);
      let batchId;
      let createdAt;
      if (
        existing &&
        parseJson(existing.selection_json)?.fingerprint ===
          selection.fingerprint
      ) {
        batchId = existing.batch_id;
        createdAt = existing.created_at;
      } else {
        batchId = `batch-${randomUUID()}`;
        createdAt = this.timestamp();
        this.database
          .prepare(
            `INSERT INTO translation_batches(
               batch_id, job_id, mode, issued_revision, created_at, selection_json
             ) VALUES(?, ?, ?, ?, ?, ?)`
          )
          .run(
            batchId,
            jobId,
            mode,
            session.revision,
            createdAt,
            canonicalJson(selection)
          );
      }

      const firstIndex = selected[0].index;
      const lastIndex = selected[selected.length - 1].index;
      const context = item => ({
        id: item.id,
        start_ms: item.start_ms,
        end_ms: item.end_ms,
        source: item.source,
        translation: item.translation || undefined,
        speaker: item.speaker,
        topic: item.topic,
      });
      return {
        batch_id: batchId,
        mode,
        complete: false,
        issued_at: createdAt,
        session: this.summarizeTranslationSession(session),
        instructions:
          mode === 'review'
            ? `Review every segment in this batch in ${session.target_language}; submit every issued ID, including unchanged translations.`
            : `Translate every segment into ${session.target_language}; submit every issued ID without modifying timing or inventing segments.`,
        glossary: clone(session.glossary || {}),
        context_before: session.segments
          .slice(Math.max(0, firstIndex - 2), firstIndex)
          .map(context),
        context_after: session.segments
          .slice(lastIndex + 1, lastIndex + 3)
          .map(context),
        segments: selected.map(({ segment }) => context(segment)),
      };
    });
  }

  submitTranslationBatch(jobId, batchIdValue, translations) {
    const batchId = String(batchIdValue || '').trim();
    if (!batchId) throw new TypeError('batch_id is required.');
    if (!Array.isArray(translations) || !translations.length) {
      throw new TypeError('translations must contain at least one segment.');
    }
    const normalized = translations.map(update => ({
      id: String(update?.id || '').trim(),
      text: String(update?.text || '').trim(),
    }));
    const seen = new Set();
    let responseCharacters = 0;
    for (const update of normalized) {
      if (!update.id)
        throw new TypeError('Translation segment id is required.');
      if (update.id.length > 200) {
        throw new TypeError(
          'Translation segment id cannot exceed 200 characters.'
        );
      }
      if (!update.text)
        throw new TypeError(`Translation is empty for segment: ${update.id}`);
      if (update.text.length > 10_000) {
        throw new TypeError(
          `Translation exceeds 10,000 characters: ${update.id}`
        );
      }
      responseCharacters += update.text.length;
      if (seen.has(update.id))
        throw new TypeError(`Duplicate segment id: ${update.id}`);
      seen.add(update.id);
    }
    if (responseCharacters > 200_000) {
      throw new TypeError('Translation batch exceeds 200,000 characters.');
    }
    const responseHash = canonicalJsonHash(
      [...normalized].sort((left, right) => left.id.localeCompare(right.id))
    );

    return this.transaction(() => {
      const batch = this.database
        .prepare(
          `SELECT job_id, mode, accepted_at, selection_json, response_hash
           FROM translation_batches WHERE batch_id = ?`
        )
        .get(batchId);
      if (!batch || batch.job_id !== jobId) {
        throw new Error(
          `Issued translation batch not found for job: ${batchId}`
        );
      }
      if (batch.accepted_at) {
        if (batch.response_hash !== responseHash) {
          throw new IdempotencyConflictError(
            'This translation batch was already accepted with different text.'
          );
        }
        const session = this.getTranslationSession(jobId);
        return {
          reused: true,
          batch_id: batchId,
          accepted_segment_ids: normalized.map(item => item.id),
          session: this.summarizeTranslationSession(session),
        };
      }
      const job = this.requireJob(jobId);
      const stage = job.stages?.[Number(job.stage_index)];
      const correctionReview =
        batch.mode === 'review' &&
        stage?.id === 'translation_validation' &&
        job.status === 'blocked' &&
        job.error?.code === 'TRANSLATION_VALIDATION_FAILED';
      if (
        !(
          (batch.mode === 'translate' &&
            stage?.id === 'translation_external' &&
            job.status === 'waiting_for_agent') ||
          correctionReview
        )
      ) {
        throw new Error(
          'The job no longer accepts this translation batch; no segment was changed.'
        );
      }
      const selection = parseJson(batch.selection_json);
      const expected = selection.segment_ids;
      const supplied = normalized.map(item => item.id);
      if (
        supplied.length !== expected.length ||
        expected.some(id => !seen.has(id)) ||
        supplied.some(id => !expected.includes(id))
      ) {
        const missing = expected.filter(id => !seen.has(id));
        const extra = supplied.filter(id => !expected.includes(id));
        throw new TypeError(
          `Batch submission must contain exactly the issued segment IDs. Missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}.`
        );
      }

      const sessionRow = this.database
        .prepare(
          'SELECT session_json FROM translation_sessions WHERE job_id = ?'
        )
        .get(jobId);
      const session = sessionRow ? parseJson(sessionRow.session_json) : null;
      if (!session)
        throw new Error(`Translation session not found for job: ${jobId}`);
      const byId = new Map(
        session.segments.map(segment => [segment.id, segment])
      );
      const selected = expected.map(id => byId.get(id));
      if (selected.some(segment => !segment)) {
        throw new IdempotencyConflictError(
          'The issued batch no longer matches this session.'
        );
      }
      const currentFingerprint = canonicalJsonHash(
        selected.map(segment => ({
          id: segment.id,
          start_ms: segment.start_ms,
          end_ms: segment.end_ms,
          source: segment.source,
          translation: segment.translation,
          status: segment.status,
        }))
      );
      if (currentFingerprint !== selection.fingerprint) {
        throw new IdempotencyConflictError(
          'The issued batch is stale because one of its segments changed. Request a new batch.'
        );
      }

      for (const update of normalized) {
        const segment = byId.get(update.id);
        if (segment.translation && segment.translation !== update.text) {
          segment.revision_count = Number(segment.revision_count || 0) + 1;
        }
        segment.translation = update.text;
        segment.status = batch.mode === 'review' ? 'reviewed' : 'translated';
      }
      assertBoundedTranslationSessionText(session.segments);
      const now = this.timestamp();
      session.revision = Number(session.revision || 0) + 1;
      session.updated_at = now;
      this.database
        .prepare(
          `UPDATE translation_sessions SET revision = ?, updated_at = ?, session_json = ?
           WHERE job_id = ?`
        )
        .run(session.revision, now, canonicalJson(session), jobId);
      this.database
        .prepare(
          `UPDATE translation_batches SET accepted_at = ?, response_hash = ?
           WHERE batch_id = ?`
        )
        .run(now, responseHash, batchId);
      return {
        reused: false,
        batch_id: batchId,
        accepted_segment_ids: expected,
        session: this.summarizeTranslationSession(session),
      };
    });
  }

  markTranslationSegmentsForCorrection(jobId, segmentIds) {
    const requested = new Set(
      (Array.isArray(segmentIds) ? segmentIds : [])
        .map(value => String(value || '').trim())
        .filter(Boolean)
    );
    if (!requested.size) return this.getTranslationSession(jobId);
    return this.transaction(() => {
      const row = this.database
        .prepare(
          'SELECT session_json FROM translation_sessions WHERE job_id = ?'
        )
        .get(jobId);
      if (!row)
        throw new Error(`Translation session not found for job: ${jobId}`);
      const session = parseJson(row.session_json);
      let changed = false;
      for (const segment of session.segments) {
        if (!requested.has(segment.id)) continue;
        if (segment.status !== 'needs_correction') {
          segment.status = 'needs_correction';
          changed = true;
        }
      }
      if (!changed) return clone(session);
      const now = this.timestamp();
      session.revision = Number(session.revision || 0) + 1;
      session.updated_at = now;
      this.database
        .prepare(
          `UPDATE translation_sessions SET revision = ?, updated_at = ?, session_json = ?
           WHERE job_id = ?`
        )
        .run(session.revision, now, canonicalJson(session), jobId);
      return clone(session);
    });
  }

  clearTranslationCorrectionMarkers(jobId) {
    return this.transaction(() => {
      const row = this.database
        .prepare(
          'SELECT session_json FROM translation_sessions WHERE job_id = ?'
        )
        .get(jobId);
      if (!row)
        throw new Error(`Translation session not found for job: ${jobId}`);
      const session = parseJson(row.session_json);
      let changed = false;
      for (const segment of session.segments) {
        if (segment.status !== 'needs_correction') continue;
        segment.status = String(segment.translation || '').trim()
          ? 'translated'
          : 'pending';
        changed = true;
      }
      if (!changed) return clone(session);
      const now = this.timestamp();
      session.revision = Number(session.revision || 0) + 1;
      session.updated_at = now;
      this.database
        .prepare(
          `UPDATE translation_sessions SET revision = ?, updated_at = ?, session_json = ?
           WHERE job_id = ?`
        )
        .run(session.revision, now, canonicalJson(session), jobId);
      return clone(session);
    });
  }
}

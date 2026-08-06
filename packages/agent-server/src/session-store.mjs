import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSrt, mergeTranslationSrt, parseSrt } from './srt.mjs';

const SESSION_VERSION = 1;
const DEFAULT_BATCH_SIZE = 8;
const MAX_BATCH_SIZE = 20;

function defaultSessionRoot() {
  return path.join(os.homedir(), '.translator-agent', 'sessions');
}

function cleanSessionId(value) {
  const sessionId = String(value || '').trim();
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(sessionId)) {
    throw new Error('Invalid session id.');
  }
  return sessionId;
}

async function ensureFile(filePath, label) {
  const absolute = path.resolve(String(filePath || '').trim());
  const stat = await fs.stat(absolute).catch(() => null);
  if (!stat?.isFile()) throw new Error(`${label} does not exist: ${absolute}`);
  return absolute;
}

function sessionPath(root, sessionId) {
  const clean = cleanSessionId(sessionId);
  return path.join(root, `${clean}.json`);
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(temporary, filePath);
}

export class TranslationSessionStore {
  constructor({ root = defaultSessionRoot() } = {}) {
    this.root = path.resolve(root);
  }

  async create({
    sourceSrt,
    targetLanguage,
    sourceLanguage = 'auto',
    existingTranslationSrt,
  }) {
    const sourcePath = await ensureFile(sourceSrt, 'Source SRT');
    const target = String(targetLanguage || '').trim();
    if (!target) throw new Error('targetLanguage is required.');
    const sourceText = await fs.readFile(sourcePath, 'utf8');
    let segments = parseSrt(sourceText);
    if (!segments.length) throw new Error('Source SRT contains no readable cues.');

    let translationPath = null;
    if (existingTranslationSrt) {
      translationPath = await ensureFile(
        existingTranslationSrt,
        'Existing translation SRT'
      );
      const translated = parseSrt(await fs.readFile(translationPath, 'utf8'));
      segments = mergeTranslationSrt(segments, translated);
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const session = {
      version: SESSION_VERSION,
      id,
      createdAt: now,
      updatedAt: now,
      sourceSrt: sourcePath,
      existingTranslationSrt: translationPath,
      sourceLanguage: String(sourceLanguage || 'auto').trim() || 'auto',
      targetLanguage: target,
      segments,
    };
    await writeJsonAtomic(sessionPath(this.root, id), session);
    return this.summarize(session);
  }

  async load(sessionId) {
    const filePath = sessionPath(this.root, sessionId);
    const raw = await fs.readFile(filePath, 'utf8').catch(error => {
      if (error?.code === 'ENOENT') {
        throw new Error(`Translation session not found: ${sessionId}`);
      }
      throw error;
    });
    const session = JSON.parse(raw);
    if (session.version !== SESSION_VERSION || !Array.isArray(session.segments)) {
      throw new Error('Unsupported or damaged translation session.');
    }
    return session;
  }

  async save(session) {
    session.updatedAt = new Date().toISOString();
    await writeJsonAtomic(sessionPath(this.root, session.id), session);
  }

  summarize(session) {
    const translated = session.segments.filter(segment =>
      String(segment.translation || '').trim()
    ).length;
    const reviewed = session.segments.filter(
      segment => segment.status === 'reviewed'
    ).length;
    return {
      sessionId: session.id,
      sourceSrt: session.sourceSrt,
      sourceLanguage: session.sourceLanguage,
      targetLanguage: session.targetLanguage,
      totalCues: session.segments.length,
      translatedCues: translated,
      reviewedCues: reviewed,
      pendingCues: session.segments.length - translated,
      percentTranslated: Math.round((translated / session.segments.length) * 100),
      updatedAt: session.updatedAt,
    };
  }

  async status(sessionId) {
    return this.summarize(await this.load(sessionId));
  }

  async getBatch(sessionId, { limit = DEFAULT_BATCH_SIZE, mode = 'translate' } = {}) {
    if (!['translate', 'review'].includes(mode)) {
      throw new Error('mode must be translate or review.');
    }
    const session = await this.load(sessionId);
    const boundedLimit = Math.min(
      MAX_BATCH_SIZE,
      Math.max(1, Number(limit) || DEFAULT_BATCH_SIZE)
    );
    const eligible = session.segments.filter(segment =>
      mode === 'review'
        ? Boolean(segment.translation) && segment.status !== 'reviewed'
        : !String(segment.translation || '').trim()
    );
    const selected = eligible.slice(0, boundedLimit);
    const byIndex = new Map(
      session.segments.map((segment, index) => [segment.id, index])
    );
    return {
      session: this.summarize(session),
      mode,
      instructions:
        mode === 'review'
          ? `Review each ${session.targetLanguage} translation against its source. Return only changed or confirmed text keyed by cue id.`
          : `Translate each cue into ${session.targetLanguage}. Preserve meaning, tone, names, and subtitle readability. Return one translation per cue id.`,
      cues: selected.map(segment => {
        const index = byIndex.get(segment.id);
        const previous = index > 0 ? session.segments[index - 1] : null;
        const next =
          index < session.segments.length - 1
            ? session.segments[index + 1]
            : null;
        return {
          id: segment.id,
          index: segment.index,
          start: segment.start,
          end: segment.end,
          source: segment.source,
          translation: segment.translation || undefined,
          previousSource: previous?.source,
          nextSource: next?.source,
        };
      }),
    };
  }

  async submit(sessionId, { translations, mode = 'translate' } = {}) {
    if (!Array.isArray(translations) || translations.length === 0) {
      throw new Error('translations must contain at least one cue update.');
    }
    if (!['translate', 'review'].includes(mode)) {
      throw new Error('mode must be translate or review.');
    }
    const session = await this.load(sessionId);
    const segmentById = new Map(
      session.segments.map(segment => [segment.id, segment])
    );
    const seen = new Set();
    for (const update of translations) {
      const id = String(update?.id || '').trim();
      const text = String(update?.text || '').trim();
      if (!segmentById.has(id)) throw new Error(`Unknown cue id: ${id}`);
      if (seen.has(id)) throw new Error(`Duplicate cue id: ${id}`);
      if (!text) throw new Error(`Translation is empty for cue: ${id}`);
      seen.add(id);
    }

    for (const update of translations) {
      const segment = segmentById.get(String(update.id).trim());
      const nextText = String(update.text).trim();
      if (segment.translation && segment.translation !== nextText) {
        segment.revisionCount = Number(segment.revisionCount || 0) + 1;
      }
      segment.translation = nextText;
      segment.status = mode === 'review' ? 'reviewed' : 'translated';
    }
    await this.save(session);
    return {
      acceptedCueIds: [...seen],
      ...this.summarize(session),
    };
  }

  async export(sessionId, { outputPath, mode = 'dual' } = {}) {
    const session = await this.load(sessionId);
    const missing = session.segments.filter(
      segment => !String(segment.translation || '').trim()
    );
    if (mode !== 'source' && missing.length) {
      throw new Error(
        `Cannot export ${mode} SRT: ${missing.length} cue(s) are still untranslated.`
      );
    }
    const destination = outputPath
      ? path.resolve(outputPath)
      : path.join(this.root, `${session.id}.${mode}.srt`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, buildSrt(session.segments, mode), 'utf8');
    return {
      sessionId: session.id,
      mode,
      outputPath: destination,
      cueCount: session.segments.length,
    };
  }
}

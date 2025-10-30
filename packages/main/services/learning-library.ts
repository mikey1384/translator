import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import crypto from 'node:crypto';
import log from 'electron-log';
import type { LearningEntry, LearningSourceType } from '@shared-types/app';

type PersistedEntry = LearningEntry;

type RecordTranscriptionArgs = {
  videoPath: string;
  videoFilename: string;
  sourceType: LearningSourceType;
  transcript: string;
  transcriptLanguage: string;
};

type RecordTranslationArgs = {
  videoPath: string;
  targetLanguage: string;
  translation: string;
};

const METADATA_FILENAME = 'metadata.json';
const TRANSCRIPT_FILENAME = 'transcript.srt';

export class LearningLibrary {
  private root: string;

  constructor() {
    const base = app.getPath('userData');
    this.root = path.join(base, 'learning-library');
    this.ensureRoot();
  }

  private ensureRoot() {
    try {
      mkdirSync(this.root, { recursive: true });
    } catch (err) {
      log.error('[LearningLibrary] Failed to ensure root directory', err);
    }
  }

  private async readEntryMetadata(entryDir: string): Promise<PersistedEntry | null> {
    try {
      const metadataPath = path.join(entryDir, METADATA_FILENAME);
      const raw = await fs.readFile(metadataPath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedEntry;
      return parsed;
    } catch (err) {
      log.warn('[LearningLibrary] Failed to read entry metadata', { entryDir, err });
      return null;
    }
  }

  private async writeEntryMetadata(entryDir: string, entry: PersistedEntry): Promise<void> {
    const metadataPath = path.join(entryDir, METADATA_FILENAME);
    await fs.writeFile(metadataPath, JSON.stringify(entry, null, 2), 'utf8');
  }

  private async findEntryDirByVideoPath(videoPath: string): Promise<string | null> {
    try {
      const dirs = await fs.readdir(this.root, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const fullDir = path.join(this.root, dir.name);
        const entry = await this.readEntryMetadata(fullDir);
        if (entry?.videoPath === videoPath) {
          return fullDir;
        }
      }
    } catch (err) {
      log.error('[LearningLibrary] Failed to search entries', err);
    }
    return null;
  }

  private createNewEntry(args: RecordTranscriptionArgs): PersistedEntry {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      title: args.videoFilename,
      videoPath: args.videoPath,
      videoDir: this.resolveVideoDir(args.videoPath),
      sourceType: args.sourceType,
      createdAt: now,
      updatedAt: now,
      transcriptLanguage: args.transcriptLanguage,
      transcriptPath: null,
      translations: {},
    };
  }

  private resolveVideoDir(videoPath: string): string | null {
    if (!videoPath) return null;
    const dir = path.parse(videoPath).dir;
    return dir || null;
  }

  private ensureSafeLanguageTag(lang: string): string {
    return lang.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-z0-9._-]+/gi, '-');
  }

  async recordTranscription(args: RecordTranscriptionArgs): Promise<PersistedEntry> {
    if (!args.videoPath) {
      throw new Error('videoPath is required to record transcription');
    }
    this.ensureRoot();
    const existingDir = await this.findEntryDirByVideoPath(args.videoPath);

    let entryDir = existingDir;
    let entry: PersistedEntry | null = null;

    if (existingDir) {
      entry = await this.readEntryMetadata(existingDir);
    }

    if (!entry || !entryDir) {
      entry = this.createNewEntry(args);
      entryDir = path.join(this.root, entry.id);
      await fs.mkdir(entryDir, { recursive: true });
    } else {
      entry.title = args.videoFilename;
      entry.sourceType = args.sourceType;
      entry.videoDir = this.resolveVideoDir(args.videoPath);
      entry.transcriptLanguage = args.transcriptLanguage;
      entry.updatedAt = new Date().toISOString();
    }

    const transcriptPath = path.join(entryDir, TRANSCRIPT_FILENAME);
    await fs.writeFile(transcriptPath, args.transcript, 'utf8');

    entry.transcriptPath = transcriptPath;
    entry.updatedAt = new Date().toISOString();

    await this.writeEntryMetadata(entryDir, entry);
    return entry;
  }

  async recordTranslation(args: RecordTranslationArgs): Promise<PersistedEntry | null> {
    if (!args.videoPath) {
      throw new Error('videoPath is required to record translation');
    }
    const entryDir = await this.findEntryDirByVideoPath(args.videoPath);
    if (!entryDir) {
      log.warn('[LearningLibrary] No entry found to record translation', {
        videoPath: args.videoPath,
      });
      return null;
    }
    const entry = await this.readEntryMetadata(entryDir);
    if (!entry) return null;

    const safeLang = this.ensureSafeLanguageTag(args.targetLanguage);
    const filename = this.sanitizeFilename(`translation-${safeLang}.srt`);
    const translationPath = path.join(entryDir, filename);
    await fs.writeFile(translationPath, args.translation, 'utf8');

    if (!entry.translations) entry.translations = {};
    entry.translations[safeLang] = translationPath;
    entry.updatedAt = new Date().toISOString();

    await this.writeEntryMetadata(entryDir, entry);
    return entry;
  }

  async listEntries(): Promise<PersistedEntry[]> {
    this.ensureRoot();
    try {
      const dirs = await fs.readdir(this.root, { withFileTypes: true });
      const entries: PersistedEntry[] = [];
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const entry = await this.readEntryMetadata(path.join(this.root, dir.name));
        if (entry) {
          entries.push(entry);
        }
      }
      entries.sort((a, b) => {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
      return entries;
    } catch (err) {
      log.error('[LearningLibrary] Failed to list entries', err);
      return [];
    }
  }
}

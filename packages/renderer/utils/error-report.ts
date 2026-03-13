import type { ErrorReportContext } from '@shared-types/app';
import type { LogEntry } from '../state/logs-store';
import { formatLog } from '../state/logs-store';
import { useAiStore } from '../state/ai-store';
import { useSubStore } from '../state/subtitle-store';
import { useTaskStore, type TranslationTask } from '../state/task-store';
import { useUIStore } from '../state/ui-store';
import { useUrlStore } from '../state/url-store';
import { useVideoStore } from '../state/video-store';

export type ErrorReportBundle = {
  fullText: string;
  condensedText: string;
  summaryText: string;
};

function stableStringify(val: any): string {
  const seen = new WeakSet();
  const helper = (v: any): any => {
    if (v && typeof v === 'object') {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
      if (Array.isArray(v)) return v.map(helper);
      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) out[k] = helper(v[k]);
      return out;
    }
    return v;
  };
  try {
    return JSON.stringify(helper(val));
  } catch {
    return '';
  }
}

function toPrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function trimText(value: unknown, max = 1600): string {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}... [truncated]`;
}

function tailLines(value: string, count: number): string {
  const lines = value.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - count)).join('\n').trim();
}

function basename(filePath?: string | null): string | null {
  const raw = String(filePath || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || raw;
}

function pickTaskSnapshot(task: TranslationTask): Record<string, unknown> | null {
  const hasSignal =
    Boolean(task.id) ||
    Boolean(task.stage) ||
    Boolean(task.inProgress) ||
    Math.round(task.percent || 0) > 0;
  if (!hasSignal) return null;

  return {
    id: task.id,
    stage: task.stage || null,
    percent: Math.round(task.percent || 0),
    inProgress: Boolean(task.inProgress),
    model: task.model || null,
    phaseKey: task.phaseKey || null,
    current: task.current ?? null,
    total: task.total ?? null,
    unit: task.unit || null,
    etaSeconds: task.etaSeconds ?? null,
  };
}

function extractRecentExceptions(entries: LogEntry[]): Array<Record<string, unknown>> {
  return entries
    .filter(entry => entry.level === 'error' || entry.kind === 'error')
    .slice(-6)
    .map(entry => {
      const meta = (entry.meta || {}) as Record<string, any>;
      const exception = meta.exception;
      const relevantMeta = {
        operationId:
          typeof meta.operationId === 'string' ? meta.operationId : undefined,
        filename: typeof meta.filename === 'string' ? meta.filename : undefined,
        lineno: typeof meta.lineno === 'number' ? meta.lineno : undefined,
        colno: typeof meta.colno === 'number' ? meta.colno : undefined,
        reasonType:
          typeof meta.reasonType === 'string' ? meta.reasonType : undefined,
      };

      return {
        at: new Date(entry.ts).toISOString(),
        message: entry.message,
        exception: exception || undefined,
        meta: Object.values(relevantMeta).some(v => v !== undefined)
          ? relevantMeta
          : undefined,
      };
    });
}

function buildSummaryLines(args: {
  mainContext: ErrorReportContext | null;
  prompt?: string | null;
  operationSnapshot: Record<string, unknown>;
  recentExceptions: Array<Record<string, unknown>>;
}): string[] {
  const { mainContext, prompt, operationSnapshot, recentExceptions } = args;
  const tasks = (operationSnapshot.tasks || {}) as Record<string, any>;
  const ui = (operationSnapshot.ui || {}) as Record<string, any>;
  const activeTask = ['dubbing', 'transcription', 'translation', 'merge', 'summary']
    .map(name => ({ name, value: tasks[name] }))
    .find(item => item.value && (item.value.inProgress || item.value.id || item.value.stage));
  const currentError = (operationSnapshot.currentError || {}) as Record<string, any>;
  const video = (operationSnapshot.video || {}) as Record<string, any>;
  const ai = (operationSnapshot.ai || {}) as Record<string, any>;

  const lines = [
    `- app: ${
      mainContext
        ? `${mainContext.app.name} ${mainContext.app.version} (${mainContext.app.environment})`
        : 'unknown'
    }`,
    `- platform: ${
      mainContext
        ? `${mainContext.system.platform} ${mainContext.system.arch} ${mainContext.system.release || ''}`.trim()
        : 'unknown'
    }`,
    `- active task: ${
      activeTask?.value
        ? `${activeTask.name} ${activeTask.value.id || ''} ${activeTask.value.percent || 0}% ${String(activeTask.value.stage || '').trim()}`.trim()
        : 'none'
    }`,
    `- current error: ${
      currentError.message ||
      (recentExceptions.length
        ? String(recentExceptions[recentExceptions.length - 1]?.message || '')
        : 'none')
    }`,
    `- video: ${
      video.pathBasename
        ? `${video.pathBasename}${video.durationSeconds ? ` (${video.durationSeconds}s)` : ''}`
        : 'none'
    }`,
    `- providers: transcription=${ai.preferredTranscriptionProvider || 'unknown'} dubbing=${
      ai.preferredDubbingProvider || 'unknown'
    } stage5Tts=${ai.stage5DubbingTtsProvider || 'unknown'} voice=${
      ui.dubVoice || 'unknown'
    }`,
  ];

  if (prompt) {
    lines.unshift(`- prompt: ${trimText(prompt, 240)}`);
  }

  return lines;
}

function buildOperationSnapshot(): Record<string, unknown> {
  const tasksState = useTaskStore.getState();
  const aiState = useAiStore.getState();
  const videoState = useVideoStore.getState();
  const uiState = useUIStore.getState();
  const urlState = useUrlStore.getState();
  const subState = useSubStore.getState();

  const segmentIds = subState.order || [];
  const translatedCount = segmentIds.reduce((count, id) => {
    const seg = subState.segments[id];
    return count + (seg?.translation?.trim() ? 1 : 0);
  }, 0);

  return {
    currentError: {
      message: urlState.error || null,
      kind: urlState.errorKind || null,
    },
    tasks: {
      transcription: pickTaskSnapshot(tasksState.transcription),
      translation: pickTaskSnapshot(tasksState.translation),
      dubbing: pickTaskSnapshot(tasksState.dubbing),
      merge: pickTaskSnapshot(tasksState.merge),
      summary: pickTaskSnapshot(tasksState.summary),
    },
    video: {
      pathBasename: basename(videoState.path),
      originalPathBasename: basename(videoState.originalPath),
      dubbedVideoBasename: basename(videoState.dubbedVideoPath),
      dubbedAudioBasename: basename(videoState.dubbedAudioPath),
      activeTrack: videoState.activeTrack,
      isAudioOnly: videoState.isAudioOnly,
      isReady: videoState.isReady,
      durationSeconds:
        typeof videoState.meta?.duration === 'number'
          ? Math.round(videoState.meta.duration)
          : null,
      width: videoState.meta?.width ?? null,
      height: videoState.meta?.height ?? null,
    },
    subtitles: {
      segmentCount: segmentIds.length,
      translatedCount,
      untranslatedCount: Math.max(0, segmentIds.length - translatedCount),
      sourceVideoLinked: Boolean(subState.sourceVideoPath),
      origin: subState.origin,
    },
    ui: {
      inputMode: uiState.inputMode,
      targetLanguage: uiState.targetLanguage,
      summaryLanguage: uiState.summaryLanguage,
      transcriptionLanguage: uiState.transcriptionLanguage,
      qualityTranscription: uiState.qualityTranscription,
      qualityTranslation: uiState.qualityTranslation,
      dubVoice: uiState.dubVoice,
      dubAmbientMix: uiState.dubAmbientMix,
    },
    ai: {
      useApiKeysMode: aiState.useApiKeysMode,
      preferredTranscriptionProvider: aiState.preferredTranscriptionProvider,
      preferredDubbingProvider: aiState.preferredDubbingProvider,
      stage5DubbingTtsProvider: aiState.stage5DubbingTtsProvider,
      preferClaudeTranslation: aiState.preferClaudeTranslation,
      preferClaudeReview: aiState.preferClaudeReview,
      preferClaudeSummary: aiState.preferClaudeSummary,
      keyPresent: aiState.keyPresent,
      anthropicKeyPresent: aiState.anthropicKeyPresent,
      elevenLabsKeyPresent: aiState.elevenLabsKeyPresent,
      byoUnlocked: aiState.byoUnlocked,
      byoAnthropicUnlocked: aiState.byoAnthropicUnlocked,
      byoElevenLabsUnlocked: aiState.byoElevenLabsUnlocked,
    },
  };
}

function buildSection(title: string, body: string | null | undefined): string {
  const text = String(body || '').trim();
  if (!text) return '';
  return `${title}:\n${text}`;
}

export function compactAndFormatLogs(entries: LogEntry[]): string {
  type PhaseGroup = {
    task: 'transcription' | 'translation';
    base: string;
    startTs: number;
    minPct: number | null;
    maxPct: number | null;
  } | null;

  type OutItem = { key: string; text: string; ts: number };
  const out: OutItem[] = [];

  let phaseGroup: PhaseGroup = null;

  const flushPhase = () => {
    if (!phaseGroup) return;
    const time = new Date(phaseGroup.startTs).toISOString();
    let range = '';
    if (phaseGroup.minPct != null && phaseGroup.maxPct != null) {
      const lo = Math.round(phaseGroup.minPct);
      const hi = Math.round(phaseGroup.maxPct);
      range = lo === hi ? ` ${lo}%` : ` ${lo}~${hi}%`;
    }
    const text = `[${time}] INFO task: ${phaseGroup.task}:phase:${phaseGroup.base}${range}`;
    const key = `PHASE|${phaseGroup.task}|${phaseGroup.base}|${range || ''}`;
    out.push({ key, text, ts: phaseGroup.startTs });
    phaseGroup = null;
  };

  const tryParsePhase = (
    e: LogEntry
  ): {
    task: 'transcription' | 'translation';
    base: string;
    pct: number | null;
  } | null => {
    if (e.kind !== 'task') return null;
    const match = /^(transcription|translation):phase:(.*)$/.exec(e.message);
    if (!match) return null;
    const task = match[1] as 'transcription' | 'translation';
    const stageText = match[2];
    const pctMatches = stageText.match(/(\d+(?:\.\d+)?)%/g) || [];
    const pctValues = pctMatches.map(v => parseFloat(v.replace('%', '')));
    const base = stageText
      .replace(/\s*\(\d+(?:\.\d+)?%\)/g, ' ')
      .replace(/\s*\d+(?:\.\d+)?%\s*/g, ' ')
      .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return {
      task,
      base,
      pct: pctValues.length ? pctValues[0] : null,
    };
  };

  const appendNonPhase = (entry: LogEntry) => {
    const text = formatLog(entry);
    const key = `${entry.level}|${entry.kind}|${entry.message}|${stableStringify(entry.meta)}`;
    out.push({ key, text, ts: entry.ts });
  };

  for (const entry of entries) {
    const parsed = tryParsePhase(entry);
    if (!parsed) {
      appendNonPhase(entry);
      continue;
    }

    if (
      phaseGroup &&
      phaseGroup.task === parsed.task &&
      phaseGroup.base === parsed.base
    ) {
      if (parsed.pct != null) {
        phaseGroup.minPct =
          phaseGroup.minPct == null
            ? parsed.pct
            : Math.min(phaseGroup.minPct, parsed.pct);
        phaseGroup.maxPct =
          phaseGroup.maxPct == null
            ? parsed.pct
            : Math.max(phaseGroup.maxPct, parsed.pct);
      }
      continue;
    }

    flushPhase();
    phaseGroup = {
      task: parsed.task,
      base: parsed.base,
      startTs: entry.ts,
      minPct: parsed.pct,
      maxPct: parsed.pct,
    };
  }

  flushPhase();

  const finalLines: string[] = [];
  let lastKey: string | null = null;
  let lastText = '';
  let count = 0;
  for (const item of out) {
    if (item.key === lastKey) {
      count += 1;
    } else {
      if (lastKey != null) {
        finalLines.push(count > 1 ? `${lastText} (x${count})` : lastText);
      }
      lastKey = item.key;
      lastText = item.text;
      count = 1;
    }
  }
  if (lastKey != null) {
    finalLines.push(count > 1 ? `${lastText} (x${count})` : lastText);
  }

  return finalLines.join('\n');
}

export function buildErrorReportBundle(args: {
  logs: LogEntry[];
  userMessage?: string;
  reportPrompt?: string | null;
  mainContext?: ErrorReportContext | null;
  mainContextError?: string | null;
}): ErrorReportBundle {
  const { logs, userMessage, reportPrompt, mainContext, mainContextError } = args;
  const operationSnapshot = buildOperationSnapshot();
  const rendererLogTail = compactAndFormatLogs(logs);
  const recentExceptions = extractRecentExceptions(logs);
  const summaryLines = buildSummaryLines({
    mainContext: mainContext ?? null,
    prompt: reportPrompt,
    operationSnapshot,
    recentExceptions,
  });

  const condensedSections = [
    'Stage5 Error Report',
    buildSection('Generated', mainContext?.generatedAt || new Date().toISOString()),
    buildSection('User Message', userMessage),
    buildSection('Summary', summaryLines.join('\n')),
    buildSection(
      'App Context',
      toPrettyJson({
        app: mainContext?.app || null,
        system: mainContext?.system || null,
        endpoints: mainContext?.endpoints || null,
        mainContextError: mainContextError || null,
      })
    ),
    buildSection('Operation Snapshot', toPrettyJson(operationSnapshot)),
    buildSection(
      'Recent Exceptions',
      recentExceptions.length ? toPrettyJson(recentExceptions) : 'None recorded.'
    ),
  ].filter(Boolean);

  const fullSections = [
    ...condensedSections,
    buildSection(
      'Main Process Log Tail',
      mainContext?.mainLog?.available
        ? mainContext.mainLog.tail || '[main log is empty]'
        : mainContext?.mainLog?.error ||
            mainContextError ||
            '[main log unavailable]'
    ),
    buildSection(
      'Renderer Log Tail',
      rendererLogTail || '[renderer log buffer is empty]'
    ),
  ].filter(Boolean);

  return {
    fullText: fullSections.join('\n\n').trim(),
    condensedText: condensedSections.join('\n\n').trim(),
    summaryText: summaryLines.join('\n').trim(),
  };
}

export function buildMailtoBody(args: {
  intro: string;
  bundle: ErrorReportBundle;
  fullBundleCopiedToClipboard: boolean;
}): string {
  const { intro, bundle, fullBundleCopiedToClipboard } = args;
  const condensed = bundle.condensedText;
  const fullInline =
    bundle.fullText.length <= 9000
      ? bundle.fullText
      : `${condensed}\n\n[Full diagnostic bundle copied to clipboard before this email opened${
          fullBundleCopiedToClipboard ? '' : '; clipboard copy failed'
        }. Paste it below if this email body is truncated.]`;

  return `${intro}\n\n${fullInline}`.trim();
}

export function buildReportPreview(args: {
  bundle: ErrorReportBundle;
  mainContext?: ErrorReportContext | null;
}): string {
  const { bundle, mainContext } = args;
  if (!mainContext?.mainLog?.available || !mainContext.mainLog.tail.trim()) {
    return bundle.fullText;
  }

  const previewMainLog = tailLines(mainContext.mainLog.tail, 80);
  return bundle.fullText.replace(
    mainContext.mainLog.tail,
    previewMainLog || '[main log is empty]'
  );
}

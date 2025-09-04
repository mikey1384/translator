import { useLogsStore, LogLevel, LogKind } from '../state/logs-store';

function add(
  level: LogLevel,
  kind: LogKind,
  message: string,
  meta?: Record<string, any>
) {
  try {
    useLogsStore.getState().add({ level, kind, message, meta });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[logger] failed to add log', err);
  }
}

export const logButton = (name: string, meta?: Record<string, any>) =>
  add('info', 'button', name, meta);

export const logVideo = (event: string, meta?: Record<string, any>) =>
  add('info', 'video', event, meta);

export const logTask = (
  phase: 'start' | 'complete' | 'cancel',
  task: 'transcription' | 'translation' | 'merge',
  meta?: Record<string, any>
) =>
  add(
    phase === 'start' ? 'info' : phase === 'cancel' ? 'warn' : 'info',
    'task',
    `${task}:${phase}`,
    meta
  );

export const logProgress = (
  action: 'open' | 'close',
  which: 'transcription' | 'translation' | 'merge'
) => add('info', 'progress', `${which}:${action}`);

export const logError = (
  where: string,
  error: any,
  meta?: Record<string, any>
) => {
  const message = `${where}: ${String(error?.message || error)}`;
  add('error', 'error', message, meta);
};

// Log phase changes concisely; do not spam percent ticks
export const logPhase = (
  task: 'transcription' | 'translation',
  stage: string,
  percent?: number,
  meta?: Record<string, any>
) => {
  const msg =
    `${task}:phase:${stage}` +
    (typeof percent === 'number' ? ` (${Math.round(percent)}%)` : '');
  add('info', 'task', msg, meta);
};

export const logSystem = (info: Record<string, any>) =>
  add('info', 'system', 'device_info', info);

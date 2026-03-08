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

function trimText(value: string, max = 2000): string {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}... [truncated]`;
}

function trimStack(value: unknown, maxLines = 12): string | undefined {
  if (typeof value !== 'string') return undefined;
  const lines = value.split('\n').slice(0, maxLines);
  const stack = lines.join('\n').trim();
  return stack ? trimText(stack, 4000) : undefined;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth >= 2) {
    return '[Truncated]';
  }
  if (typeof value === 'string') {
    return trimText(value, 600);
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 6).map(item => sanitizeValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).slice(0, 10)) {
      out[key] = sanitizeValue(source[key], depth + 1);
    }
    return out;
  }
  return String(value);
}

function serializeErrorLike(error: any):
  | {
      name?: string;
      message: string;
      stack?: string;
      code?: string;
      status?: number;
      responseData?: unknown;
      cause?: unknown;
    }
  | undefined {
  if (error == null) return undefined;
  if (typeof error === 'string') {
    return { message: trimText(error) };
  }
  if (typeof error !== 'object') {
    return { message: trimText(String(error)) };
  }

  const message = trimText(
    String(error?.message || error?.reason?.message || error)
  );
  const details: {
    name?: string;
    message: string;
    stack?: string;
    code?: string;
    status?: number;
    responseData?: unknown;
    cause?: unknown;
  } = {
    message,
  };

  if (typeof error?.name === 'string' && error.name.trim()) {
    details.name = trimText(error.name, 120);
  }
  if (error?.code != null) {
    details.code = trimText(String(error.code), 120);
  }
  if (typeof error?.status === 'number') {
    details.status = error.status;
  } else if (typeof error?.response?.status === 'number') {
    details.status = error.response.status;
  }

  const stack = trimStack(error?.stack);
  if (stack) details.stack = stack;

  const responseData = sanitizeValue(error?.response?.data);
  if (responseData !== undefined) {
    details.responseData = responseData;
  }

  const cause = sanitizeValue(error?.cause ?? error?.reason);
  if (cause !== undefined) {
    details.cause = cause;
  }

  return details;
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
  const serialized = serializeErrorLike(error);
  const payload =
    serialized || meta
      ? {
          ...(meta || {}),
          ...(serialized ? { exception: serialized } : {}),
        }
      : undefined;
  add('error', 'error', message, payload);
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

import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogKind =
  | 'button'
  | 'video'
  | 'task'
  | 'progress'
  | 'error'
  | 'system'
  | 'ui'
  | 'network';

export interface LogEntry {
  id: string;
  ts: number; // epoch ms
  level: LogLevel;
  kind: LogKind;
  message: string;
  meta?: Record<string, any> | undefined;
}

interface State {
  logs: LogEntry[];
  max: number; // capacity
}

interface Actions {
  add(entry: Omit<LogEntry, 'id' | 'ts'> & { ts?: number }): void;
  clear(): void;
  // Returns last N logs (default 30)
  recent(n?: number): LogEntry[];
}

export const useLogsStore = createWithEqualityFn<State & Actions>()(
  immer<State & Actions>((set, get) => ({
    logs: [] as LogEntry[],
    max: 200,

    add(entry) {
      set(s => {
        const e: LogEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ts: entry.ts ?? Date.now(),
          level: entry.level,
          kind: entry.kind,
          message: entry.message,
          meta: entry.meta,
        };
        s.logs.push(e);
        if (s.logs.length > s.max) {
          s.logs.splice(0, s.logs.length - s.max);
        }
      });
    },

    clear() {
      set(s => {
        s.logs = [];
      });
    },

    recent(n = 30) {
      const all = (get().logs || []).slice();
      return all.slice(Math.max(0, all.length - n));
    },
  }))
);

export function formatLog(entry: LogEntry): string {
  const time = new Date(entry.ts).toISOString();
  const base = `[${time}] ${entry.level.toUpperCase()} ${entry.kind}: ${entry.message}`;
  if (!entry.meta) return base;
  try {
    const m = JSON.stringify(entry.meta);
    return `${base} ${m}`;
  } catch {
    return base;
  }
}

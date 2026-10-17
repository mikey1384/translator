import { createWithEqualityFn } from 'zustand/traditional';

/**
 * A video subtitled only as far as the balance reached. Kept per source so
 * the offer survives a restart and the library can say "Preview · 4 of 28".
 *
 * - offer: preview ready (or nothing covered), waiting for the user
 * - dismissed: "Not now"; the offer shrinks to a quiet line
 * - checkout: Stripe opened in the browser
 * - resuming: paid; transcribing and translating the rest
 * - failed: resume stopped; the offer comes back with a retry
 */
export type FreePreviewStatus =
  | 'offer'
  | 'dismissed'
  | 'checkout'
  | 'resuming'
  | 'failed';

/** Why finishing stopped, so the card can say what to do. */
export type FreePreviewFailure = 'network' | 'other';

export interface FreePreview {
  key: string;
  durationSecs: number;
  coveredSecs: number;
  language: string;
  status: FreePreviewStatus;
  failure?: FreePreviewFailure;
  /** The rest was transcribed; only translating it is left. */
  transcribedToEnd?: boolean;
  updatedAt: number;
}

const STORAGE_KEY = 'freePreviews.v1';
const MAX_ITEMS = 30;

function read(): Record<string, FreePreview> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, FreePreview> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, any>)) {
      if (
        value &&
        typeof value.durationSecs === 'number' &&
        typeof value.coveredSecs === 'number' &&
        typeof value.language === 'string'
      ) {
        // A resume or checkout cut short by a restart is an open offer again.
        const status: FreePreviewStatus =
          value.status === 'dismissed' ? 'dismissed' : 'offer';
        out[key] = { ...value, key, status };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function write(items: Record<string, FreePreview>) {
  try {
    const sorted = Object.values(items)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ITEMS);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(sorted.map(item => [item.key, item])))
    );
  } catch {
    // Storage is a convenience; the in-memory state still drives the UI.
  }
}

interface FreePreviewState {
  items: Record<string, FreePreview>;
  save: (item: Omit<FreePreview, 'updatedAt'>) => void;
  setStatus: (
    key: string,
    status: FreePreviewStatus,
    failure?: FreePreviewFailure
  ) => void;
  clear: (key: string) => void;
}

export const useFreePreviewStore = createWithEqualityFn<FreePreviewState>()(
  set => ({
    items: read(),
    save: item =>
      set(state => {
        const items = {
          ...state.items,
          [item.key]: { ...item, updatedAt: Date.now() },
        };
        write(items);
        return { items };
      }),
    setStatus: (key, status, failure) =>
      set(state => {
        const current = state.items[key];
        if (!current) return state;
        const items = {
          ...state.items,
          [key]: {
            ...current,
            status,
            failure: status === 'failed' ? failure : undefined,
            updatedAt: Date.now(),
          },
        };
        write(items);
        return { items };
      }),
    clear: key =>
      set(state => {
        if (!state.items[key]) return state;
        const items = { ...state.items };
        delete items[key];
        write(items);
        return { items };
      }),
  })
);

/** The key a preview is filed under: the original file, else the link. */
export function freePreviewKey({
  originalPath,
  path,
  sourceUrl,
}: {
  originalPath?: string | null;
  path?: string | null;
  sourceUrl?: string | null;
}): string | null {
  return originalPath || path || sourceUrl || null;
}

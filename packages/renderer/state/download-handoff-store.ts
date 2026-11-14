import { createWithEqualityFn } from 'zustand/traditional';

/**
 * The "download finished, watch it with subtitles" moment after a link
 * download. Filed under the link, which stays the same when the user saves
 * the file somewhere else.
 *
 * - ready: the download just mounted; the card may show
 * - dismissed: "Not now"; never shown again for this video (persisted)
 */
export type DownloadHandoffStatus = 'ready' | 'dismissed';

export interface DownloadHandoff {
  key: string;
  status: DownloadHandoffStatus;
  /** Where "Download only" saved the copy, for the card's "Saved to" line. */
  savedPath?: string;
  updatedAt: number;
}

const STORAGE_KEY = 'downloadHandoffs.v1';
const MAX_ITEMS = 100;

/** Only dismissals outlive the session; a card is for a download just made. */
function read(): Record<string, DownloadHandoff> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    const out: Record<string, DownloadHandoff> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, any>)) {
      if (value?.status === 'dismissed') {
        out[key] = {
          key,
          status: 'dismissed',
          updatedAt: Number(value.updatedAt) || 0,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function write(items: Record<string, DownloadHandoff>) {
  try {
    const dismissed = Object.values(items)
      .filter(item => item.status === 'dismissed')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ITEMS)
      .map(item => [
        item.key,
        { status: item.status, updatedAt: item.updatedAt },
      ]);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(dismissed))
    );
  } catch {
    // Storage is a convenience; the in-memory state still drives the UI.
  }
}

interface DownloadHandoffState {
  items: Record<string, DownloadHandoff>;
  /** A link download finished and its video is open. */
  arm: (key: string) => void;
  setSavedPath: (key: string, savedPath: string) => void;
  dismiss: (key: string) => void;
  /** A run started from anywhere: the moment has passed. */
  consume: (key: string) => void;
}

export const useDownloadHandoffStore =
  createWithEqualityFn<DownloadHandoffState>()(set => ({
    items: read(),
    arm: key =>
      set(state => {
        // "Not now" holds for this video, even when it is downloaded again.
        if (state.items[key]?.status === 'dismissed') return state;
        return {
          items: {
            ...state.items,
            [key]: { key, status: 'ready', updatedAt: Date.now() },
          },
        };
      }),
    setSavedPath: (key, savedPath) =>
      set(state => {
        const current = state.items[key];
        if (!current || current.status !== 'ready') return state;
        return {
          items: {
            ...state.items,
            [key]: { ...current, savedPath, updatedAt: Date.now() },
          },
        };
      }),
    dismiss: key =>
      set(state => {
        const items = {
          ...state.items,
          [key]: {
            key,
            status: 'dismissed' as const,
            updatedAt: Date.now(),
          },
        };
        write(items);
        return { items };
      }),
    consume: key =>
      set(state => {
        if (state.items[key]?.status !== 'ready') return state;
        const items = { ...state.items };
        delete items[key];
        return { items };
      }),
  }));

/** A handoff belongs to the link the video was downloaded from. */
export function downloadHandoffKey({
  sourceUrl,
}: {
  sourceUrl?: string | null;
}): string | null {
  const url = typeof sourceUrl === 'string' ? sourceUrl.trim() : '';
  return url || null;
}

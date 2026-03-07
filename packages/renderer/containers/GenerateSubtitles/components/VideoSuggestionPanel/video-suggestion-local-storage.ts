import type { VideoSuggestionPreferenceSlots } from '@shared-types/app';
import {
  isVideoSuggestionRecency,
  sanitizeVideoSuggestionCountry,
  sanitizeVideoSuggestionHistoryPath,
  sanitizeVideoSuggestionPreference,
  sanitizeVideoSuggestionWebUrl,
} from '../../../../../shared/helpers/video-suggestion-sanitize.js';
import {
  createDefaultVideoSuggestionLocalPrefs,
  VIDEO_SUGGESTION_DEFAULT_RECENCY,
} from '../../../../../shared/helpers/video-suggestion-defaults.js';
import type {
  LocalVideoSuggestionPrefs,
  SuggestionViewTab,
  VideoSuggestionDownloadHistoryItem,
} from './VideoSuggestionPanel.types.js';

const LOCAL_VIDEO_SUGGESTION_PREFS_KEY = 'video-suggestion-prefs-v1';
const LOCAL_VIDEO_SUGGESTION_HISTORY_KEY = 'video-suggestion-downloads-v1';
const LOCAL_VIDEO_SUGGESTION_HIDDEN_CHANNELS_KEY =
  'video-suggestion-hidden-channels-v1';
const LOCAL_VIDEO_SUGGESTION_ACTIVE_TAB_KEY = 'video-suggestion-active-tab-v1';

export const MAX_HISTORY_ITEMS = 40;
const MAX_HIDDEN_CHANNELS = 80;
const SUGGESTION_VIEW_TABS: SuggestionViewTab[] = [
  'results',
  'history',
  'channels',
];

export function readLocalVideoSuggestionPrefs(): LocalVideoSuggestionPrefs {
  try {
    const raw = window.localStorage.getItem(LOCAL_VIDEO_SUGGESTION_PREFS_KEY);
    if (!raw) {
      return createDefaultVideoSuggestionLocalPrefs();
    }
    const parsed = JSON.parse(raw) as {
      country?: unknown;
      recency?: unknown;
      preferences?: unknown;
    };
    const prefSource =
      parsed?.preferences && typeof parsed.preferences === 'object'
        ? (parsed.preferences as Record<string, unknown>)
        : {};
    return {
      country: sanitizeVideoSuggestionCountry(parsed?.country),
      recency: isVideoSuggestionRecency(parsed?.recency)
        ? parsed.recency
        : VIDEO_SUGGESTION_DEFAULT_RECENCY,
      preferences: {
        topic: sanitizeVideoSuggestionPreference(prefSource?.topic),
        creator: sanitizeVideoSuggestionPreference(prefSource?.creator),
        subtopic: sanitizeVideoSuggestionPreference(prefSource?.subtopic),
      },
    };
  } catch {
    return createDefaultVideoSuggestionLocalPrefs();
  }
}

export function writeLocalVideoSuggestionPrefs(
  patch: Partial<LocalVideoSuggestionPrefs>
): void {
  try {
    const current = readLocalVideoSuggestionPrefs();
    const nextPreferencesPatch =
      patch.preferences && typeof patch.preferences === 'object'
        ? patch.preferences
        : ({} as VideoSuggestionPreferenceSlots);
    const next: LocalVideoSuggestionPrefs = {
      country:
        patch.country != null
          ? sanitizeVideoSuggestionCountry(patch.country)
          : current.country,
      recency:
        patch.recency != null && isVideoSuggestionRecency(patch.recency)
          ? patch.recency
          : current.recency,
      preferences: {
        topic:
          nextPreferencesPatch.topic != null
            ? sanitizeVideoSuggestionPreference(nextPreferencesPatch.topic)
            : sanitizeVideoSuggestionPreference(current.preferences.topic),
        creator:
          nextPreferencesPatch.creator != null
            ? sanitizeVideoSuggestionPreference(nextPreferencesPatch.creator)
            : sanitizeVideoSuggestionPreference(current.preferences.creator),
        subtopic:
          nextPreferencesPatch.subtopic != null
            ? sanitizeVideoSuggestionPreference(nextPreferencesPatch.subtopic)
            : sanitizeVideoSuggestionPreference(current.preferences.subtopic),
      },
    };
    window.localStorage.setItem(
      LOCAL_VIDEO_SUGGESTION_PREFS_KEY,
      JSON.stringify(next)
    );
  } catch {
    // Ignore localStorage failures (private mode / quota / policy).
  }
}

function sanitizeHistoryItem(
  input: unknown
): VideoSuggestionDownloadHistoryItem | null {
  const raw = input && typeof input === 'object' ? (input as any) : null;
  if (!raw) return null;
  const sourceUrl = String(raw.sourceUrl || '').trim();
  if (!sourceUrl) return null;
  const title = String(raw.title || '').trim() || sourceUrl;
  const downloadedAtIso =
    String(raw.downloadedAtIso || '').trim() || new Date().toISOString();
  const id =
    String(raw.id || '').trim() ||
    `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const out: VideoSuggestionDownloadHistoryItem = {
    id,
    sourceUrl,
    title: title.slice(0, 300),
    downloadedAtIso,
  };
  const thumbnailUrl = String(raw.thumbnailUrl || '').trim();
  const channel = String(raw.channel || '').trim();
  const channelUrl = sanitizeVideoSuggestionWebUrl(raw.channelUrl);
  const uploadedAt = String(raw.uploadedAt || '').trim();
  const localPath = sanitizeVideoSuggestionHistoryPath(raw.localPath);
  if (thumbnailUrl) out.thumbnailUrl = thumbnailUrl.slice(0, 2000);
  if (channel) out.channel = channel.slice(0, 240);
  if (channelUrl) out.channelUrl = channelUrl;
  if (uploadedAt) out.uploadedAt = uploadedAt.slice(0, 40);
  if (
    typeof raw.durationSec === 'number' &&
    Number.isFinite(raw.durationSec) &&
    raw.durationSec > 0
  ) {
    out.durationSec = raw.durationSec;
  }
  if (localPath) out.localPath = localPath;
  return out;
}

export function readLocalVideoSuggestionHistory(): VideoSuggestionDownloadHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_VIDEO_SUGGESTION_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items = parsed
      .map(item => sanitizeHistoryItem(item))
      .filter((item): item is VideoSuggestionDownloadHistoryItem =>
        Boolean(item)
      );
    return items.slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function writeLocalVideoSuggestionHistory(
  items: VideoSuggestionDownloadHistoryItem[]
): void {
  try {
    const sanitized = items
      .map(item => sanitizeHistoryItem(item))
      .filter((item): item is VideoSuggestionDownloadHistoryItem =>
        Boolean(item)
      )
      .slice(0, MAX_HISTORY_ITEMS);
    window.localStorage.setItem(
      LOCAL_VIDEO_SUGGESTION_HISTORY_KEY,
      JSON.stringify(sanitized)
    );
  } catch {
    // Ignore localStorage failures (private mode / quota / policy).
  }
}

function sanitizeChannelHistoryKey(input: unknown): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .slice(0, 260);
}

export function readLocalVideoSuggestionHiddenChannels(): string[] {
  try {
    const raw = window.localStorage.getItem(
      LOCAL_VIDEO_SUGGESTION_HIDDEN_CHANNELS_KEY
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      const key = sanitizeChannelHistoryKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
      if (out.length >= MAX_HIDDEN_CHANNELS) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function writeLocalVideoSuggestionHiddenChannels(keys: string[]): void {
  try {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of keys) {
      const key = sanitizeChannelHistoryKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
      if (out.length >= MAX_HIDDEN_CHANNELS) break;
    }
    window.localStorage.setItem(
      LOCAL_VIDEO_SUGGESTION_HIDDEN_CHANNELS_KEY,
      JSON.stringify(out)
    );
  } catch {
    // Ignore localStorage failures (private mode / quota / policy).
  }
}

export function isSuggestionViewTab(
  value: unknown
): value is SuggestionViewTab {
  return (
    typeof value === 'string' &&
    SUGGESTION_VIEW_TABS.includes(value as SuggestionViewTab)
  );
}

export function readLocalVideoSuggestionActiveTab(): SuggestionViewTab {
  try {
    const raw = window.localStorage.getItem(
      LOCAL_VIDEO_SUGGESTION_ACTIVE_TAB_KEY
    );
    if (isSuggestionViewTab(raw)) return raw;
    return 'results';
  } catch {
    return 'results';
  }
}

export function writeLocalVideoSuggestionActiveTab(
  tab: SuggestionViewTab
): void {
  try {
    window.localStorage.setItem(LOCAL_VIDEO_SUGGESTION_ACTIVE_TAB_KEY, tab);
  } catch {
    // Ignore localStorage failures (private mode / quota / policy).
  }
}

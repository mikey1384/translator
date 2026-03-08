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
  GenerateSubtitlesWorkspaceTab,
  LocalVideoSuggestionPrefs,
  VideoSuggestionDownloadHistoryItem,
} from './VideoSuggestionPanel.types.js';

const LOCAL_VIDEO_SUGGESTION_PREFS_KEY = 'video-suggestion-prefs-v1';
const LOCAL_VIDEO_SUGGESTION_HISTORY_KEY = 'video-suggestion-downloads-v1';
const LOCAL_VIDEO_SUGGESTION_HIDDEN_CHANNELS_KEY =
  'video-suggestion-hidden-channels-v1';
const LOCAL_GENERATE_SUBTITLES_WORKSPACE_TAB_KEY =
  'generate-subtitles-workspace-tab-v1';

export const MAX_HISTORY_ITEMS = 40;
const MAX_HIDDEN_CHANNELS = 80;
const GENERATE_SUBTITLES_WORKSPACE_TABS: GenerateSubtitlesWorkspaceTab[] = [
  'source',
  'recommend',
  'history',
  'channels',
  'workflow',
];
const VIDEO_SUGGESTION_HISTORY_SYNC_EVENT =
  'video-suggestion-history-sync-needed';

function normalizeHistoryPath(value: unknown): string {
  return sanitizeVideoSuggestionHistoryPath(value)
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function isLikelyManagedTempHistoryPath(value: unknown): boolean {
  const normalized = normalizeHistoryPath(value);
  if (!normalized) return false;
  return (
    normalized.includes('/translator-electron/') ||
    normalized.includes('/translator-url-')
  );
}

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

function dispatchVideoSuggestionHistorySync(): void {
  try {
    window.dispatchEvent(new CustomEvent(VIDEO_SUGGESTION_HISTORY_SYNC_EVENT));
  } catch {
    // Ignore DOM event failures.
  }
}

export function upsertLocalVideoSuggestionHistoryItem(
  item: VideoSuggestionDownloadHistoryItem
): VideoSuggestionDownloadHistoryItem[] {
  const sanitized = sanitizeHistoryItem(item);
  if (!sanitized) {
    return readLocalVideoSuggestionHistory();
  }

  const nextItems = mergeVideoSuggestionHistoryItems(
    readLocalVideoSuggestionHistory(),
    sanitized
  );

  writeLocalVideoSuggestionHistory(nextItems);
  dispatchVideoSuggestionHistorySync();
  return nextItems;
}

export function mergeVideoSuggestionHistoryItems(
  items: VideoSuggestionDownloadHistoryItem[],
  item: VideoSuggestionDownloadHistoryItem
): VideoSuggestionDownloadHistoryItem[] {
  const sanitized = sanitizeHistoryItem(item);
  if (!sanitized) {
    return items
      .map(existing => sanitizeHistoryItem(existing))
      .filter((existing): existing is VideoSuggestionDownloadHistoryItem =>
        Boolean(existing)
      )
      .slice(0, MAX_HISTORY_ITEMS);
  }

  const incomingPathKey = normalizeHistoryPath(sanitized.localPath);
  const incomingIsTemp = isLikelyManagedTempHistoryPath(sanitized.localPath);
  const nextItems = [sanitized];

  for (const rawExisting of items) {
    const existing = sanitizeHistoryItem(rawExisting);
    if (!existing) continue;

    const existingPathKey = normalizeHistoryPath(existing.localPath);
    if (incomingPathKey && existingPathKey === incomingPathKey) {
      continue;
    }

    if (existing.sourceUrl !== sanitized.sourceUrl) {
      nextItems.push(existing);
      continue;
    }

    if (!existingPathKey || !incomingPathKey) {
      continue;
    }

    const existingIsTemp = isLikelyManagedTempHistoryPath(existing.localPath);
    if (existingIsTemp && incomingIsTemp) {
      continue;
    }

    nextItems.push(existing);
  }

  return nextItems.slice(0, MAX_HISTORY_ITEMS);
}

export function syncSavedVideoSuggestionHistoryPath(options: {
  previousPath: string;
  savedPath: string;
}): boolean {
  const previousPath = sanitizeVideoSuggestionHistoryPath(options.previousPath);
  const savedPath = sanitizeVideoSuggestionHistoryPath(options.savedPath);
  if (!previousPath || !savedPath) return false;

  const previousKey = normalizeHistoryPath(previousPath);
  const savedKey = normalizeHistoryPath(savedPath);
  if (!previousKey || !savedKey) return false;

  const items = readLocalVideoSuggestionHistory();
  let changed = false;
  const nextItems = items.map(item => {
    if (normalizeHistoryPath(item.localPath) !== previousKey) {
      return item;
    }
    if (normalizeHistoryPath(item.localPath) === savedKey) {
      return item;
    }
    changed = true;
    return {
      ...item,
      localPath: savedPath,
    };
  });

  if (!changed) return false;

  writeLocalVideoSuggestionHistory(nextItems);
  dispatchVideoSuggestionHistorySync();
  return true;
}

export function subscribeToVideoSuggestionHistorySync(
  listener: () => void
): () => void {
  const wrapped = () => {
    listener();
  };
  window.addEventListener(VIDEO_SUGGESTION_HISTORY_SYNC_EVENT, wrapped);
  return () => {
    window.removeEventListener(VIDEO_SUGGESTION_HISTORY_SYNC_EVENT, wrapped);
  };
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

export function isGenerateSubtitlesWorkspaceTab(
  value: unknown
): value is GenerateSubtitlesWorkspaceTab {
  return (
    typeof value === 'string' &&
    GENERATE_SUBTITLES_WORKSPACE_TABS.includes(
      value as GenerateSubtitlesWorkspaceTab
    )
  );
}

export function readGenerateSubtitlesWorkspaceTab(): GenerateSubtitlesWorkspaceTab {
  try {
    const raw = window.localStorage.getItem(
      LOCAL_GENERATE_SUBTITLES_WORKSPACE_TAB_KEY
    );
    if (isGenerateSubtitlesWorkspaceTab(raw)) return raw;
    return 'source';
  } catch {
    return 'source';
  }
}

export function writeGenerateSubtitlesWorkspaceTab(
  tab: GenerateSubtitlesWorkspaceTab
): void {
  if (!isGenerateSubtitlesWorkspaceTab(tab)) return;
  try {
    window.localStorage.setItem(
      LOCAL_GENERATE_SUBTITLES_WORKSPACE_TAB_KEY,
      tab
    );
  } catch {
    // Ignore localStorage failures (private mode / quota / policy).
  }
}

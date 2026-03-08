import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore, useVideoStore } from '../../../state';
import { useUrlStore } from '../../../state/url-store';
import {
  sanitizeVideoSuggestionHistoryPath,
  sanitizeVideoSuggestionWebUrl,
} from '../../../../shared/helpers/video-suggestion-sanitize.js';
import {
  buildVideoMetaDetails,
  resolveErrorText,
} from '../components/VideoSuggestionPanel/video-suggestion-helpers.js';
import {
  readLocalVideoSuggestionHiddenChannels,
  readLocalVideoSuggestionHistory,
  subscribeToVideoSuggestionHistorySync,
  writeLocalVideoSuggestionHiddenChannels,
  writeLocalVideoSuggestionHistory,
} from '../components/VideoSuggestionPanel/video-suggestion-local-storage.js';
import type { VideoSuggestionDownloadHistoryItem } from '../components/VideoSuggestionPanel/VideoSuggestionPanel.types.js';
import type { VideoSuggestionResultItem } from '@shared-types/app';

type RecentDownloadedChannel = {
  key: string;
  name: string;
  channelUrl?: string;
  downloadedAtIso: string;
};

export default function useDownloadedVideoLibrary(
  preferredLanguage: string
) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [downloadHistory, setDownloadHistory] = useState<
    VideoSuggestionDownloadHistoryItem[]
  >(() => readLocalVideoSuggestionHistory());
  const [hiddenChannelKeys, setHiddenChannelKeys] = useState<string[]>(() =>
    readLocalVideoSuggestionHiddenChannels()
  );
  const [playablePathMap, setPlayablePathMap] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    writeLocalVideoSuggestionHistory(downloadHistory);
  }, [downloadHistory]);

  useEffect(() => {
    writeLocalVideoSuggestionHiddenChannels(hiddenChannelKeys);
  }, [hiddenChannelKeys]);

  useEffect(() => {
    return subscribeToVideoSuggestionHistorySync(() => {
      setDownloadHistory(readLocalVideoSuggestionHistory());
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshPlayableState = async () => {
      const itemsWithPath = downloadHistory.filter(item =>
        Boolean(item.localPath)
      );
      if (itemsWithPath.length === 0) {
        if (!cancelled) {
          setPlayablePathMap({});
        }
        return;
      }

      const checks = await Promise.all(
        itemsWithPath.map(async item => {
          try {
            return [
              item.id,
              Boolean(await window.fileApi.fileExists(item.localPath || '')),
            ] as const;
          } catch {
            return [item.id, false] as const;
          }
        })
      );

      if (cancelled) return;
      const next: Record<string, boolean> = {};
      for (const [id, exists] of checks) {
        next[id] = exists;
      }
      setPlayablePathMap(next);
    };

    void refreshPlayableState();
    return () => {
      cancelled = true;
    };
  }, [downloadHistory]);

  const recentDownloadedChannels = useMemo(
    () =>
      downloadHistory
        .filter(item => Boolean(item.channelUrl) || Boolean(item.channel))
        .reduce<RecentDownloadedChannel[]>((acc, item) => {
          const channelUrl = sanitizeVideoSuggestionWebUrl(item.channelUrl);
          const fallbackName = String(item.channel || '').trim();
          const key = (channelUrl || fallbackName.toLowerCase()).trim();
          if (!key) return acc;
          if (hiddenChannelKeys.includes(key.toLowerCase())) return acc;
          if (acc.some(existing => existing.key === key)) return acc;
          acc.push({
            key,
            name:
              fallbackName ||
              t('input.videoSuggestion.unknownChannel', 'Unknown channel'),
            channelUrl: channelUrl || undefined,
            downloadedAtIso: item.downloadedAtIso,
          });
          return acc;
        }, [])
        .slice(0, 8),
    [downloadHistory, hiddenChannelKeys, t]
  );

  const openVideoExternally = useCallback(
    async (url: string) => {
      try {
        await window.appShell.openExternal(url);
      } catch (err: any) {
        setError(
          resolveErrorText(
            err?.message,
            t(
              'input.videoSuggestion.openFailed',
              'Failed to open YouTube video link'
            ),
            t
          )
        );
      }
    },
    [t]
  );

  const openChannelExternally = useCallback(
    async (channelUrl?: string, channelName?: string) => {
      const direct = sanitizeVideoSuggestionWebUrl(channelUrl);
      const fallbackChannel = String(channelName || '').trim();
      const targetUrl =
        direct ||
        (fallbackChannel
          ? `https://www.youtube.com/results?search_query=${encodeURIComponent(fallbackChannel)}`
          : '');
      if (!targetUrl) {
        setError(
          t(
            'input.videoSuggestion.channelUnavailable',
            'Channel link is not available for this item.'
          )
        );
        return;
      }

      try {
        await window.appShell.openExternal(targetUrl);
      } catch (err: any) {
        setError(
          resolveErrorText(
            err?.message,
            t(
              'input.videoSuggestion.openChannelFailed',
              'Failed to open YouTube channel'
            ),
            t
          )
        );
      }
    },
    [t]
  );

  const openDownloadedVideo = useCallback(
    async (item: VideoSuggestionDownloadHistoryItem) => {
      const filePath = sanitizeVideoSuggestionHistoryPath(item.localPath);
      if (!filePath) {
        setError(
          t(
            'input.videoSuggestion.missingLocalFile',
            'Local file path is missing for this history item.'
          )
        );
        return;
      }

      try {
        const exists = await window.fileApi.fileExists(filePath);
        setPlayablePathMap(prev => ({
          ...prev,
          [item.id]: exists,
        }));
        if (!exists) {
          setError(
            t(
              'input.videoSuggestion.downloadedFileMissing',
              'The local file is no longer available at its saved path.'
            )
          );
          return;
        }

        const fallbackName =
          filePath.split(/[\\/]/).pop() || item.title || 'video';
        await useVideoStore.getState().setFile({
          name: fallbackName,
          path: filePath,
        });
        useUIStore.getState().setInputMode('file');
      } catch (err: any) {
        setError(
          resolveErrorText(
            err?.message,
            t(
              'input.videoSuggestion.cannotOpenDownloadedFile',
              'Could not open downloaded file.'
            ),
            t
          )
        );
      }
    },
    [t]
  );

  const redownloadHistoryItem = useCallback(
    async (item: VideoSuggestionDownloadHistoryItem) => {
      try {
        await useUrlStore.getState().downloadMedia({
          url: item.sourceUrl,
        });
      } catch (err: any) {
        setError(
          resolveErrorText(
            err?.message,
            t('input.videoSuggestion.downloadFailed', 'Download failed'),
            t
          )
        );
      }
    },
    [t]
  );

  const removeHistoryItem = useCallback((id: string) => {
    setDownloadHistory(prev => prev.filter(item => item.id !== id));
    setPlayablePathMap(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const removeChannelHistoryItem = useCallback((key: string) => {
    const normalized = String(key || '')
      .trim()
      .toLowerCase();
    if (!normalized) return;
    setHiddenChannelKeys(prev => {
      if (prev.includes(normalized)) return prev;
      return [normalized, ...prev].slice(0, 80);
    });
  }, []);

  const formatHistoryTimestamp = useCallback(
    (iso: string): string => {
      const parsed = Date.parse(iso);
      if (!Number.isFinite(parsed)) return '';
      return new Intl.DateTimeFormat(preferredLanguage || 'en', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(parsed));
    },
    [preferredLanguage]
  );

  const buildHistoryMetaDetails = useCallback(
    (item: VideoSuggestionResultItem): string[] =>
      buildVideoMetaDetails(item, preferredLanguage, t),
    [preferredLanguage, t]
  );

  return {
    buildHistoryMetaDetails,
    downloadHistory,
    error,
    formatHistoryTimestamp,
    localPrimaryActionLabel: t('input.videoSuggestion.playLocal', 'Play'),
    openChannelExternally,
    openDownloadedVideo,
    openVideoExternally,
    playablePathMap,
    recentDownloadedChannels,
    redownloadHistoryItem,
    removeChannelHistoryItem,
    removeHistoryItem,
    setError,
  };
}

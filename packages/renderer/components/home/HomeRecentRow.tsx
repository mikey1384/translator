import VideoCostLine from '../VideoCostLine';
import { css } from '@emotion/css';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFreePreviewStore } from '../../state/free-preview-store';
import { wholeMinutes } from '../../utils/freePreview';
import type { VideoSuggestionDownloadHistoryItem } from '../../containers/GenerateSubtitles/components/VideoSuggestionPanel/VideoSuggestionPanel.types.js';
import * as FileIPC from '../../ipc/file';
import { colors } from '../../styles';

const section = css`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const headerRow = css`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
`;

const label = css`
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${colors.gray};
`;

const seeAll = css`
  background: none;
  border: 0;
  padding: 4px 0;
  color: ${colors.textDim};
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;

  &:hover {
    color: ${colors.text};
  }
`;

const grid = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
`;

const card = css`
  padding: 12px;
  border-radius: 18px;
  background: ${colors.surfaceSoft};
  border: 1px solid ${colors.border};
  display: flex;
  flex-direction: column;
  gap: 9px;
  text-align: start;
  font: inherit;
  color: ${colors.text};
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    transform 0.15s ease;

  &:hover {
    border-color: ${colors.borderStrong};
    transform: translateY(-2px);
  }

  &:focus-visible {
    outline: 2px solid ${colors.primaryLight};
    outline-offset: 2px;
  }
`;

const thumb = css`
  position: relative;
  height: 96px;
  border-radius: 12px;
  overflow: hidden;
  background: ${colors.surfaceRaised};

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`;

const duration = css`
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
  font-size: 0.75rem;
  color: ${colors.text};
`;

const title = css`
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const state = (ready: boolean, accent = false) => css`
  font-size: 0.8rem;
  color: ${accent ? colors.primary : ready ? colors.success : colors.textDim};
`;

function formatDuration(seconds?: number): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

type SubtitleState = { ready: boolean; language: string | null };

interface HomeRecentRowProps {
  items: VideoSuggestionDownloadHistoryItem[];
  onOpen: (item: VideoSuggestionDownloadHistoryItem) => void;
  onSeeAll: () => void;
}

export default function HomeRecentRow({
  items,
  onOpen,
  onSeeAll,
}: HomeRecentRowProps) {
  const { t } = useTranslation();
  const recent = items.slice(0, 3);
  const previews = useFreePreviewStore(s => s.items);
  const [subtitleStates, setSubtitleStates] = useState<
    Record<string, SubtitleState>
  >({});
  const recentKey = recent.map(item => item.id).join('|');

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      recent.map(async item => {
        try {
          const found = await FileIPC.findSubtitleDocumentForSource({
            sourceVideoPath: item.localPath ?? null,
            sourceUrl: item.sourceUrl || null,
          });
          return [
            item.id,
            {
              ready: Boolean(found?.success && found.found && found.document),
              language: found?.document?.targetLanguage || null,
            },
          ] as const;
        } catch {
          return [item.id, { ready: false, language: null }] as const;
        }
      })
    ).then(entries => {
      if (!cancelled) setSubtitleStates(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentKey]);

  if (recent.length === 0) return null;

  const describe = (item: VideoSuggestionDownloadHistoryItem) => {
    const preview =
      (item.localPath && previews[item.localPath]) ||
      (item.sourceUrl && previews[item.sourceUrl]) ||
      null;
    if (preview) {
      return {
        ready: false,
        accent: true,
        text:
          preview.coveredSecs > 0
            ? t(
                'freePreview.quietPreview',
                'Preview · {{covered}} of {{total}} min',
                {
                  covered: wholeMinutes(preview.coveredSecs),
                  total: wholeMinutes(preview.durationSecs),
                }
              )
            : t('freePreview.quietNone', 'Not subtitled yet · {{total}} min', {
                total: wholeMinutes(preview.durationSecs),
              }),
      };
    }
    const subtitles = subtitleStates[item.id];
    if (subtitles?.ready && subtitles.language) {
      const languageName = t(`languages.${subtitles.language}`, {
        defaultValue: subtitles.language,
      });
      return {
        ready: true,
        text: t('home.recentSubtitlesReady', '{{language}} subtitles ready', {
          language: languageName,
        }),
      };
    }
    if (subtitles?.ready) {
      return {
        ready: true,
        text: t('home.recentSubtitlesReadyGeneric', 'Subtitles ready'),
      };
    }
    return { ready: false, text: t('home.recentDownloaded', 'Downloaded') };
  };

  return (
    <section className={section} aria-labelledby="home-recent-label">
      <div className={headerRow}>
        <span id="home-recent-label" className={label}>
          {t('home.recent', 'Recent')}
        </span>
        <button type="button" className={seeAll} onClick={onSeeAll}>
          {t('home.seeAll', 'See all')}
        </button>
      </div>
      <div className={grid}>
        {recent.map(item => {
          const status = describe(item);
          const length = formatDuration(item.durationSec);
          return (
            <button
              key={item.id}
              type="button"
              className={card}
              onClick={() => onOpen(item)}
            >
              <div className={thumb}>
                {item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt="" loading="lazy" />
                ) : null}
                {length ? <span className={duration}>{length}</span> : null}
              </div>
              <span className={title}>{item.title}</span>
              <span
                className={state(
                  status.ready,
                  'accent' in status && Boolean(status.accent)
                )}
              >
                {status.text}
              </span>
              {!status.ready && !('accent' in status && status.accent) ? (
                <VideoCostLine durationSec={item.durationSec} />
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

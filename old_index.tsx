import { useCallback, useEffect, useMemo, useState } from 'react';
import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import Section from '../../components/Section';
import { colors } from '../../styles';
import type { LearningEntry } from '@shared-types/app';
import * as LearningIPC from '../../ipc/learning';
import { parseSrt } from '../../../shared/helpers';
import { useSubStore, useUIStore, useVideoStore } from '../../state';

const layoutStyles = css`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const listStyles = css`
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid ${colors.border};
  border-radius: 12px;
  overflow: hidden;
  background-color: ${colors.light};
`;

const entryStyles = css`
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: ${colors.grayLight};
  }

  &:not(:last-of-type) {
    border-bottom: 1px solid ${colors.border};
  }
`;

const entrySelectedStyles = css`
  background: linear-gradient(135deg, ${colors.grayLight}, ${colors.light});
  border-left: 3px solid ${colors.primary};
`;

const entryTitleStyles = css`
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: ${colors.dark};
  font-weight: 600;
  font-size: 1rem;
`;

const metaRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: ${colors.gray};
  font-size: 0.85rem;
`;

const metaItemStyles = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

const languagesRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const languageTagStyles = css`
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: ${colors.grayLight};
  color: ${colors.dark};
  font-size: 0.8rem;
  text-transform: capitalize;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;

  &:hover {
    background: ${colors.primary};
    color: ${colors.white};
  }
`;

const languageTagActiveStyles = css`
  background: ${colors.primary};
  color: ${colors.white};
`;

const emptyStateStyles = css`
  text-align: center;
  padding: 32px;
  color: ${colors.gray};
  font-size: 0.95rem;
`;

const infoStyles = css`
  color: ${colors.gray};
  font-size: 0.85rem;
`;

const warningStyles = css`
  border: 1px solid ${colors.warning};
  background: rgba(247, 85, 154, 0.15);
  color: ${colors.dark};
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.85rem;
`;

const viewerStyles = css`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const previewVideoStyles = css`
  width: 100%;
  max-width: 720px;
  aspect-ratio: 16 / 9;
  background: ${colors.grayLight};
  border: 1px solid ${colors.border};
  border-radius: 12px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
  object-fit: contain;
`;

type LanguageKey = 'transcript' | string;

const formatTimestamp = (value: string, locale: string) => {
  try {
    return new Date(value).toLocaleString(locale, {
      hour12: false,
    });
  } catch {
    return value;
  }
};

const friendlySource = (
  source: LearningEntry['sourceType'],
  t: ReturnType<typeof useTranslation>['t']
) => {
  switch (source) {
    case 'downloaded':
      return t('learningHub.source.downloaded', 'Downloaded video');
    case 'opened':
      return t('learningHub.source.opened', 'Opened from device');
    default:
      return t('learningHub.source.unknown', 'Source unknown');
  }
};

const normalizeDir = (dir: string | null) => {
  if (!dir) return null;
  return dir;
};

export default function LearningHub() {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<LearningEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    id: string;
    language: LanguageKey;
  } | null>(null);
  const [videoMissing, setVideoMissing] = useState(false);
  const [srtError, setSrtError] = useState<string | null>(null);
  const activeShell = useUIStore(s => s.activeShell);
  const activeVideoUrl = useVideoStore(s => s.url);

  const refreshEntries = useCallback(async () => {
    setLoading(true);
    try {
      const list = await LearningIPC.listEntries();
      setEntries(list);
      setError(null);
      setSelected(prev =>
        prev && list.some(entry => entry.id === prev.id) ? prev : null
      );
      if (list.length === 0) {
        setVideoMissing(false);
        setSrtError(null);
      }
    } catch (err: any) {
      console.error('[LearningHub] Failed to load entries', err);
      setError(err?.message ?? 'Unable to load learning history');
      setEntries([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshEntries();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshEntries, activeShell]);

  const handleSelectLanguage = useCallback(
    async (entry: LearningEntry, language: LanguageKey) => {
      const filePath =
        language === 'transcript'
          ? entry.transcriptPath
          : entry.translations[language];

      if (!filePath) {
        setSrtError(
          t(
            'learningHub.errors.missingFile',
            'No subtitles saved for this selection.'
          )
        );
        return;
      }

      setSrtError(null);
      setVideoMissing(false);

      try {
        const content = await (window as any).fileApi.readText(filePath);
        const segments = parseSrt(content ?? '');
        useSubStore
          .getState()
          .load(segments, filePath, 'disk', entry.videoPath ?? null);
        try {
          useUIStore.getState().setEditPanelOpen(true);
        } catch {
          // ignore UI store errors
        }
        setSelected({ id: entry.id, language });
      } catch (err) {
        console.error('[LearningHub] Failed to open subtitles', err);
        setSrtError(
          t('learningHub.errors.failedToLoad', 'Unable to open subtitles.')
        );
        return;
      }

      if (entry.videoPath) {
        let exists: boolean | null = null;
        try {
          const res = await (window as any).electron.pathExists?.(
            entry.videoPath
          );
          exists = Boolean(res?.exists);
        } catch (err) {
          console.error('[LearningHub] Failed to verify video path', err);
          exists = null;
        }

        if (exists === false) {
          setVideoMissing(true);
          return;
        }

        try {
          await useVideoStore.getState().setFile({
            name: entry.title,
            path: entry.videoPath,
            sourceKind: entry.sourceType ?? 'unknown',
          });
          setVideoMissing(false);
        } catch (err) {
          console.error('[LearningHub] Failed to mount video', err);
          setVideoMissing(true);
        }
      } else {
        setVideoMissing(true);
      }
    },
    [t]
  );

  const selectedEntry = useMemo(
    () => entries.find(entry => entry.id === selected?.id) ?? null,
    [entries, selected?.id]
  );

  return (
    <Section
      title={t('learningHub.title', 'Learning Hub')}
      headerRight={
        <span
          className={css`
            font-size: 0.85rem;
            color: ${colors.gray};
          `}
        >
          {t('learningHub.statusInProgress', 'Preview')}
        </span>
      }
    >
      <div className={layoutStyles}>
        {loading ? (
          <div className={emptyStateStyles}>
            {t('learningHub.loading', 'Loading your transcribed videos…')}
          </div>
        ) : error ? (
          <div className={warningStyles}>{error}</div>
        ) : entries.length === 0 ? (
          <div className={emptyStateStyles}>
            {t(
              'learningHub.empty',
              'Transcribe a video to see it appear in your learning history.'
            )}
          </div>
        ) : (
          <ul className={listStyles}>
            {entries.map(entry => {
              const languageOptions: { key: LanguageKey; label: string }[] = [];
              if (entry.transcriptPath) {
                languageOptions.push({
                  key: 'transcript',
                  label: t(
                    'learningHub.languages.original',
                    'Original transcript'
                  ),
                });
              }
              Object.keys(entry.translations || {})
                .sort()
                .forEach(code => {
                  languageOptions.push({
                    key: code,
                    label: t(
                      'learningHub.languages.translation',
                      '{{lang}} translation',
                      {
                        lang: code,
                      }
                    ),
                  });
                });

              const defaultLanguage = languageOptions[0]?.key;

              return (
                <li
                  key={entry.id}
                  className={cx(
                    entryStyles,
                    selected?.id === entry.id && entrySelectedStyles
                  )}
                  onClick={() => {
                    if (defaultLanguage) {
                      void handleSelectLanguage(entry, defaultLanguage);
                    }
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      if (defaultLanguage) {
                        void handleSelectLanguage(entry, defaultLanguage);
                      }
                    }
                  }}
                  role="listitem"
                  tabIndex={0}
                >
                  <div className={entryTitleStyles}>
                    <span>{entry.title}</span>
                    <span className={infoStyles}>
                      {normalizeDir(entry.videoDir) ??
                        t('learningHub.noPath', 'Location unknown')}
                    </span>
                  </div>
                  <div className={metaRowStyles}>
                    <span className={metaItemStyles}>
                      {friendlySource(entry.sourceType, t)}
                    </span>
                    <span className={metaItemStyles}>
                      {t('learningHub.updatedAt', 'Updated {{date}}', {
                        date: formatTimestamp(entry.updatedAt, i18n.language),
                      })}
                    </span>
                  </div>
                  {languageOptions.length > 0 && (
                    <div className={languagesRowStyles}>
                      {languageOptions.map(option => (
                        <span
                          key={option.key}
                          className={cx(
                            languageTagStyles,
                            selected?.id === entry.id &&
                              selected.language === option.key
                              ? languageTagActiveStyles
                              : null
                          )}
                          onClick={event => {
                            event.stopPropagation();
                            void handleSelectLanguage(entry, option.key);
                          }}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleSelectLanguage(entry, option.key);
                            }
                          }}
                          tabIndex={0}
                        >
                          {option.label}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className={viewerStyles}>
          {selectedEntry ? (
            <>
              <div className={metaRowStyles}>
                <span className={metaItemStyles}>
                  {t('learningHub.viewing', 'Viewing: {{title}}', {
                    title: selectedEntry.title,
                  })}
                </span>
                {selected?.language && (
                  <span className={metaItemStyles}>
                    {selected?.language === 'transcript'
                      ? t(
                          'learningHub.languages.original',
                          'Original transcript'
                        )
                      : t(
                          'learningHub.languages.translation',
                          '{{lang}} translation',
                          {
                            lang: selected.language,
                          }
                        )}
                  </span>
                )}
              </div>
              {srtError && <div className={warningStyles}>{srtError}</div>}
              {videoMissing && (
                <div className={warningStyles}>
                  {t(
                    'learningHub.videoMissing',
                    'The original video could not be found. You can still review the subtitles.'
                  )}
                </div>
              )}
              {!videoMissing && activeVideoUrl ? (
                <video
                  key={`${selectedEntry.id}-${selected?.language ?? 'transcript'}`}
                  className={previewVideoStyles}
                  controls
                  src={activeVideoUrl}
                />
              ) : null}
            </>
          ) : (
            <div className={emptyStateStyles}>
              {t(
                'learningHub.selectPrompt',
                'Select a saved video to review its subtitles and playback.'
              )}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

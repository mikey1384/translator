import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { JSX } from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import type {
  SrtSegment,
  TranscriptHighlight,
  TranscriptSummarySection,
} from '@shared-types/app';
import Button from './Button';
import ErrorBanner from './ErrorBanner';
import {
  TRANSLATION_LANGUAGE_GROUPS,
  TRANSLATION_LANGUAGES_BASE,
} from '../constants/translation-languages';
import {
  colors,
  selectStyles,
  progressBarBackgroundStyles,
  progressBarFillStyles,
} from '../styles';
import { useUIStore, useTaskStore, useSubStore, useVideoStore } from '../state';
import {
  generateTranscriptSummary,
  onTranscriptSummaryProgress,
} from '../ipc/subtitles';
import { save as saveFile } from '../ipc/file';

interface TranscriptSummaryPanelProps {
  segments: SrtSegment[];
}

export function TranscriptSummaryPanel({
  segments,
}: TranscriptSummaryPanelProps): JSX.Element | null {
  const { t } = useTranslation();
  const summaryLanguage = useUIStore(s => s.summaryLanguage);
  const setSummaryLanguage = useUIStore(s => s.setSummaryLanguage);

  const [summary, setSummary] = useState<string>('');
  const [highlights, setHighlights] = useState<TranscriptHighlight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [highlightProgressLabel, setHighlightProgressLabel] = useState('');
  const [highlightProgressPercent, setHighlightProgressPercent] = useState(0);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(
    null
  );
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [activeTab, setActiveTab] = useState<
    'summary' | 'sections' | 'highlights'
  >('summary');
  const [downloadStatus, setDownloadStatus] = useState<
    Record<string, 'idle' | 'saving' | 'saved' | 'error'>
  >({});
  const downloadTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );
  const [sections, setSections] = useState<TranscriptSummarySection[]>([]);

  const originalVideoPath = useVideoStore(s => s.originalPath);
  const fallbackVideoPath = useSubStore(s => s.sourceVideoPath);

  const usableSegments = useMemo(
    () =>
      segments
        .map(seg => ({
          start: seg.start,
          end: seg.end,
          text: (seg.original ?? '').trim(),
        }))
        .filter(seg => seg.text.length > 0),
    [segments]
  );

  const hasTranscript = usableSegments.length > 0;

  useEffect(() => {
    return () => {
      Object.values(downloadTimers.current).forEach(timer => {
        clearTimeout(timer);
      });
      downloadTimers.current = {};
    };
  }, []);

  useEffect(() => {
    if (!activeOperationId) return;

    const unsubscribe = onTranscriptSummaryProgress(progress => {
      if (progress.operationId !== activeOperationId) return;
      const nextLabel = translateStageLabel(progress.stage ?? '', t);
      const pct = typeof progress.percent === 'number' ? progress.percent : 0;
      const clampedPercent = Math.min(100, Math.max(0, pct));
      const isHighlightStage = /highlight/i.test(nextLabel);
      if (isHighlightStage) {
        setHighlightProgressLabel(nextLabel);
        setHighlightProgressPercent(clampedPercent);
      } else {
        setProgressLabel(nextLabel);
        setProgressPercent(clampedPercent);
      }

      if (typeof progress.partialSummary === 'string') {
        setSummary(progress.partialSummary.trim());
      }

      if (Array.isArray(progress.partialHighlights)) {
        const partialHighlights =
          progress.partialHighlights as TranscriptHighlight[];
        setHighlights(partialHighlights);
        setDownloadStatus(prev => {
          const next: Record<string, 'idle' | 'saving' | 'saved' | 'error'> =
            {};
          partialHighlights.forEach((highlight, highlightIndex) => {
            const key = getHighlightKey(highlight, highlightIndex);
            if (prev[key]) {
              next[key] = prev[key];
            }
          });
          return next;
        });
      }

      if (progress.partialHighlights || progress.stage === 'Highlights ready') {
        setHighlightProgressLabel(nextLabel);
        setHighlightProgressPercent(clampedPercent);
      }

      if (Array.isArray(progress.partialSections)) {
        setSections(progress.partialSections as TranscriptSummarySection[]);
      }

      if (progress.partialSummary) {
        setCopyStatus('idle');
      }

      useTaskStore.getState().setSummary({
        id: activeOperationId,
        stage: nextLabel,
        percent: pct,
        inProgress: pct < 100,
      });

      if (progress.error) {
        const message = String(progress.error);
        setError(
          message === 'insufficient-credits'
            ? t('summary.insufficientCredits')
            : t('summary.error', { message })
        );
      }

      if (pct >= 100 && !/highlight/i.test(nextLabel)) {
        useTaskStore.getState().setSummary({
          stage: t('summary.status.ready'),
          percent: 100,
          inProgress: false,
          id: activeOperationId,
        });
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [activeOperationId, t]);

  const handleGenerate = useCallback(async () => {
    if (!hasTranscript || isGenerating) return;

    const opId = `summary-${Date.now()}`;

    setIsGenerating(true);
    setActiveOperationId(opId);
    setError(null);
    Object.values(downloadTimers.current).forEach(timer => clearTimeout(timer));
    downloadTimers.current = {};
    setSummary('');
    setHighlights([]);
    setSections([]);
    setDownloadStatus({});
    setCopyStatus('idle');
    setProgressLabel(t('summary.status.preparing'));
    setProgressPercent(0);
    setHighlightProgressLabel('');
    setHighlightProgressPercent(0);
    useTaskStore.getState().setSummary({
      id: opId,
      stage: t('summary.status.preparing'),
      percent: 0,
      inProgress: true,
    });

    try {
      const result = await generateTranscriptSummary({
        segments: usableSegments,
        targetLanguage: summaryLanguage,
        operationId: opId,
        videoPath: originalVideoPath || fallbackVideoPath || null,
        maxHighlights: 10,
      });

      if (result?.error) {
        throw new Error(result.error);
      }

      if (result?.summary) {
        setSummary(result.summary.trim());
      }
      if (Array.isArray(result?.sections)) {
        setSections(result.sections as TranscriptSummarySection[]);
      }
      if (Array.isArray(result?.highlights)) {
        const finalHighlights = result.highlights as TranscriptHighlight[];
        setHighlights(finalHighlights);
        setDownloadStatus(prev => {
          const next: Record<string, 'idle' | 'saving' | 'saved' | 'error'> =
            {};
          finalHighlights.forEach((highlight, highlightIndex) => {
            const key = getHighlightKey(highlight, highlightIndex);
            if (prev[key]) {
              next[key] = prev[key];
            }
          });
          return next;
        });
      }

      setProgressLabel(t('summary.status.ready'));
      setProgressPercent(100);
      useTaskStore.getState().setSummary({
        stage: t('summary.status.ready'),
        percent: 100,
        inProgress: false,
        id: null,
      });
    } catch (err: any) {
      const message = String(err?.message || err);
      setError(
        message === 'insufficient-credits'
          ? t('summary.insufficientCredits')
          : t('summary.error', { message })
      );
      setProgressLabel(t('summary.status.error'));
      useTaskStore.getState().setSummary({
        stage: t('summary.status.error'),
        percent: progressPercent,
        inProgress: false,
        id: null,
      });
    } finally {
      setIsGenerating(false);
      setActiveOperationId(null);
      setCopyStatus('idle');
    }
  }, [
    hasTranscript,
    isGenerating,
    summaryLanguage,
    usableSegments,
    t,
    progressPercent,
    originalVideoPath,
    fallbackVideoPath,
  ]);

  const handleDownloadHighlight = useCallback(
    async (highlight: TranscriptHighlight, index: number) => {
      if (!highlight?.videoPath) return;
      const key = getHighlightKey(highlight, index);

      setDownloadStatus(prev => ({ ...prev, [key]: 'saving' }));

      try {
        const defaultName = buildHighlightFilename(highlight, index);
        const result = await saveFile({
          sourcePath: highlight.videoPath,
          defaultPath: defaultName,
          filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
          title: t('summary.saveHighlightDialogTitle', 'Save highlight clip'),
        });

        if (!result?.success || !result.filePath) {
          throw new Error(result?.error || 'Unknown error');
        }

        setDownloadStatus(prev => ({ ...prev, [key]: 'saved' }));
        if (downloadTimers.current[key]) {
          clearTimeout(downloadTimers.current[key]);
        }
        downloadTimers.current[key] = setTimeout(() => {
          setDownloadStatus(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          delete downloadTimers.current[key];
        }, 4000);
      } catch (err: any) {
        console.error('[TranscriptSummaryPanel] save highlight failed', err);
        setDownloadStatus(prev => ({ ...prev, [key]: 'error' }));
        if (downloadTimers.current[key]) {
          clearTimeout(downloadTimers.current[key]);
        }
        downloadTimers.current[key] = setTimeout(() => {
          setDownloadStatus(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          delete downloadTimers.current[key];
        }, 5000);

        setError(
          t('summary.downloadHighlightFailed', {
            message: err?.message || String(err),
          })
        );
      }
    },
    [t]
  );

  const handleCopy = useCallback(async () => {
    if (!summary) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(summary);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = summary;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopyStatus('copied');
    } catch (err) {
      console.error('[TranscriptSummaryPanel] copy failed', err);
      setCopyStatus('idle');
      setError(t('summary.copyError'));
    }
  }, [summary, t]);

  useEffect(() => {
    if (copyStatus !== 'copied') return;
    const timer = window.setTimeout(() => setCopyStatus('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  useEffect(() => {
    if (!summary) {
      setCopyStatus('idle');
    }
  }, [summary]);

  if (!hasTranscript) {
    return null;
  }

  const showProgressBar = isGenerating || activeOperationId !== null;
  const showHighlightProgress =
    highlightProgressPercent > 0 &&
    (isGenerating || activeOperationId !== null);

  return (
    <div className={panelStyles}>
      <div className={headerRowStyles}>
        <div>
          <h3 className={titleStyles}>{t('summary.title')}</h3>
          <p className={subtitleStyles}>{t('summary.ctaHelper')}</p>
        </div>
        <div className={controlsStyles}>
          <label className={labelStyles}>{t('summary.languageLabel')}</label>
          <select
            className={selectStyles}
            value={summaryLanguage}
            onChange={e => setSummaryLanguage(e.target.value)}
            disabled={isGenerating}
          >
            {TRANSLATION_LANGUAGES_BASE.map(opt => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
            {TRANSLATION_LANGUAGE_GROUPS.map(group => (
              <optgroup key={group.labelKey} label={t(group.labelKey)}>
                {group.options.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            onClick={handleGenerate}
            disabled={isGenerating}
            isLoading={isGenerating}
          >
            {summary ? t('summary.regenerate') : t('summary.generate')}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className={tabsRowStyles}>
        <button
          className={tabButtonStyles(activeTab === 'summary')}
          onClick={() => setActiveTab('summary')}
          disabled={isGenerating}
        >
          {t('summary.tab.summary', 'Summary')}
        </button>
        <button
          className={tabButtonStyles(activeTab === 'sections')}
          onClick={() => setActiveTab('sections')}
          disabled={isGenerating}
        >
          {t('summary.tab.sections', 'Detailed notes')}
        </button>
        <button
          className={tabButtonStyles(activeTab === 'highlights')}
          onClick={() => setActiveTab('highlights')}
          disabled={isGenerating}
        >
          {t('summary.tab.highlights', 'Highlights')}
        </button>
      </div>

      {showProgressBar && (
        <div className={progressWrapperStyles}>
          <div className={progressHeaderStyles}>
            <span>{progressLabel || t('summary.status.inProgress')}</span>
            <span className={progressPercentStyles}>
              {Math.round(progressPercent)}%
            </span>
          </div>
          <div className={progressBarBackgroundStyles}>
            <div className={progressBarFillStyles(progressPercent)} />
          </div>
        </div>
      )}

      {showHighlightProgress && (
        <div className={progressWrapperStyles}>
          <div className={progressHeaderStyles}>
            <span>
              {highlightProgressLabel ||
                t('summary.highlightsInProgress', 'Preparing highlight clips…')}
            </span>
            <span className={progressPercentStyles}>
              {Math.round(highlightProgressPercent)}%
            </span>
          </div>
          <div className={progressBarBackgroundStyles}>
            <div className={progressBarFillStyles(highlightProgressPercent)} />
          </div>
        </div>
      )}

      {error && (
        <div className={errorWrapperStyles}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
        </div>
      )}

      {activeTab === 'summary' && summary && (
        <>
          <div className={summaryHeaderStyles}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCopy}
              disabled={!summary}
            >
              {copyStatus === 'copied'
                ? t('summary.copied')
                : t('summary.copy')}
            </Button>
          </div>
          <div className={summaryBoxStyles}>
            <pre>{summary}</pre>
          </div>
        </>
      )}

      {activeTab === 'sections' && (
        <div className={sectionsListStyles}>
          {sections.length === 0 ? (
            <div className={noHighlightsStyles}>
              {t('summary.noSections', 'No section notes yet.')}
            </div>
          ) : (
            sections.map(section => {
              const paragraphs: string[] = section.content
                .split(/\n{2,}/)
                .map(part => part.trim())
                .filter(part => part.length > 0);

              return (
                <div key={section.index} className={sectionCardStyles}>
                  <div className={sectionHeaderStyles}>
                    <span className={sectionIndexStyles}>
                      {t('summary.sectionHeading', {
                        index: section.index,
                      })}
                    </span>
                    <span className={sectionTitleStyles}>{section.title}</span>
                  </div>
                  <div className={sectionContentStyles}>
                    {paragraphs.length === 0 ? (
                      <p className={sectionParagraphStyles}>
                        {section.content}
                      </p>
                    ) : (
                      paragraphs.map((paragraph, idx) => (
                        <p key={idx} className={sectionParagraphStyles}>
                          {paragraph}
                        </p>
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'highlights' && (
        <div className={highlightsGridStyles}>
          {highlights.length === 0 && (
            <div className={noHighlightsStyles}>
              {t(
                'summary.noHighlights',
                'No highlights yet. Generate to detect punchlines.'
              )}
            </div>
          )}
          {highlights.map((h, idx) => {
            const key = getHighlightKey(h, idx);
            const status = downloadStatus[key] || 'idle';

            return (
              <div key={`${h.start}-${h.end}-${idx}`} className={highlightCard}>
                <div className={highlightHeader}>
                  <div className={highlightTitle}>
                    {h.title || t('summary.highlight', 'Highlight')}
                  </div>
                  <div className={highlightTime}>
                    {formatRange(h.start, h.end)}
                  </div>
                </div>
                {h.videoPath ? (
                  <video
                    className={highlightVideo}
                    controls
                    src={toFileUrl(h.videoPath)}
                  />
                ) : (
                  <div className={noVideoStyles}>
                    {t(
                      'summary.noVideoForHighlights',
                      'Open the source video to cut highlight clips.'
                    )}
                  </div>
                )}
                {h.description && (
                  <div className={highlightDesc}>{h.description}</div>
                )}
                {h.videoPath && (
                  <div className={highlightActions}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDownloadHighlight(h, idx)}
                      disabled={status === 'saving'}
                    >
                      {status === 'saving'
                        ? t('summary.downloadingHighlight', 'Saving…')
                        : t('summary.downloadHighlight', 'Download clip')}
                    </Button>
                    {status === 'saved' && (
                      <span className={highlightStatusSuccess}>
                        {t('summary.highlightSaved', 'Saved!')}
                      </span>
                    )}
                    {status === 'error' && (
                      <span className={highlightStatusError}>
                        {t('summary.highlightSaveError', 'Save failed')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getHighlightKey(h: TranscriptHighlight, index: number): string {
  return `${h.videoPath || ''}-${index}`;
}

function buildHighlightFilename(h: TranscriptHighlight, index: number): string {
  const base = h.title ? slugify(h.title) : `highlight-${index + 1}`;
  const startSeconds = Math.max(0, Math.floor(h.start || 0));
  const startStamp = formatHHMMSS(startSeconds).replace(/:/g, '-');
  const safeBase = base || `highlight-${index + 1}`;
  return `${safeBase}-${startStamp}.mp4`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function translateStageLabel(
  stage: string,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const text = String(stage || '').toLowerCase();
  if (!text) return '';

  if (text.includes('preparing')) {
    return t('summary.status.preparing');
  }
  const chunkMatch = text.match(/section\s+(\d+)\s+of\s+(\d+)/);
  if (chunkMatch) {
    return t('summary.status.chunk', {
      current: Number(chunkMatch[1]),
      total: Number(chunkMatch[2]),
    });
  }
  if (text.includes('synthesizing')) {
    return t('summary.status.synthesizing');
  }
  if (text.includes('ready')) {
    return t('summary.status.ready');
  }
  if (text.includes('cancel')) {
    return t('summary.status.cancelled');
  }
  if (text.includes('error')) {
    return t('summary.status.error');
  }
  return stage;
}

function toFileUrl(p: string): string {
  if (!p) return p;
  if (p.startsWith('file://')) return p;
  const normalized = p.replace(/\\/g, '/');

  if (/^[a-zA-Z]:\//.test(normalized)) {
    // Windows absolute path → ensure triple slash
    return `file:///${encodeURI(normalized)}`;
  }

  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`;
  }

  return `file://${encodeURI(`/${normalized}`)}`;
}

function formatRange(a: number, b: number): string {
  const s = Math.max(0, Math.floor(a || 0));
  const e = Math.max(0, Math.floor(b || 0));
  return `${formatHHMMSS(s)} – ${formatHHMMSS(e)}`;
}

function formatHHMMSS(total: number): string {
  const hh = Math.floor(total / 3600)
    .toString()
    .padStart(2, '0');
  const mm = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const ss = Math.floor(total % 60)
    .toString()
    .padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const panelStyles = css`
  border: 1px solid ${colors.border};
  border-radius: 10px;
  padding: 18px 20px;
  background: ${colors.light};
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const tabsRowStyles = css`
  display: flex;
  gap: 8px;
`;

const tabButtonStyles = (active: boolean) => css`
  border: 1px solid ${active ? colors.primary : colors.border};
  background: ${active ? colors.primary : colors.white};
  color: ${active ? colors.white : colors.dark};
  border-radius: 20px;
  padding: 6px 12px;
  font-size: 0.9rem;
  cursor: pointer;
`;

const headerRowStyles = css`
  display: flex;
  flex-direction: column;
  gap: 14px;

  @media (min-width: 720px) {
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-end;
  }
`;

const controlsStyles = css`
  display: flex;
  flex-direction: column;
  gap: 8px;

  @media (min-width: 720px) {
    flex-direction: row;
    align-items: center;
    gap: 12px;
  }
`;

const titleStyles = css`
  margin: 0;
  font-size: 1.1rem;
  color: ${colors.dark};
`;

const subtitleStyles = css`
  margin: 4px 0 0;
  color: ${colors.gray};
  max-width: 520px;
`;

const labelStyles = css`
  font-size: 0.9rem;
  font-weight: 600;
  color: ${colors.dark};
`;

const progressWrapperStyles = css`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const progressHeaderStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: ${colors.dark};
  font-size: 0.9rem;
`;

const progressPercentStyles = css`
  font-variant-numeric: tabular-nums;
  color: ${colors.primaryDark};
`;

const summaryBoxStyles = css`
  background: ${colors.white};
  border: 1px solid ${colors.border};
  border-radius: 8px;
  padding: 14px;
  min-height: 180px;
  max-height: 340px;
  overflow-y: auto;
  font-size: 0.95rem;
  line-height: 1.55;

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
  }
`;

const highlightsGridStyles = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
`;

const noHighlightsStyles = css`
  color: ${colors.gray};
`;

const highlightCard = css`
  background: ${colors.white};
  border: 1px solid ${colors.border};
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const highlightHeader = css`
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: baseline;
`;

const highlightTitle = css`
  font-weight: 600;
  color: ${colors.dark};
`;

const highlightTime = css`
  color: ${colors.gray};
  font-size: 0.85rem;
`;

const highlightVideo = css`
  width: 100%;
  border-radius: 6px;
  background: #000;
`;

const noVideoStyles = css`
  color: ${colors.gray};
  font-size: 0.9rem;
  background: ${colors.grayLight};
  border: 1px dashed ${colors.border};
  border-radius: 6px;
  padding: 10px;
  text-align: center;
`;

const highlightDesc = css`
  color: ${colors.dark};
  font-size: 0.95rem;
`;

const highlightActions = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
`;

const highlightStatusSuccess = css`
  font-size: 0.85rem;
  color: ${colors.success};
`;

const highlightStatusError = css`
  font-size: 0.85rem;
  color: ${colors.danger};
`;

const sectionsListStyles = css`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const sectionCardStyles = css`
  background: ${colors.white};
  border: 1px solid ${colors.border};
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const sectionHeaderStyles = css`
  display: flex;
  flex-direction: column;
  gap: 4px;

  @media (min-width: 720px) {
    flex-direction: row;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
  }
`;

const sectionIndexStyles = css`
  color: ${colors.gray};
  font-size: 0.85rem;
  font-weight: 600;
`;

const sectionTitleStyles = css`
  color: ${colors.dark};
  font-weight: 600;
  font-size: 1rem;
`;

const sectionContentStyles = css`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const sectionParagraphStyles = css`
  margin: 0;
  color: ${colors.dark};
  line-height: 1.55;
  white-space: pre-wrap;
`;

const summaryHeaderStyles = css`
  display: flex;
  justify-content: flex-end;
`;

const errorWrapperStyles = css`
  display: flex;
  align-items: center;
`;

export default TranscriptSummaryPanel;

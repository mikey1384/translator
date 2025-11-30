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
  HighlightAspectMode,
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
import {
  useUIStore,
  useTaskStore,
  useSubStore,
  useVideoStore,
  useCreditStore,
} from '../state';
import {
  generateTranscriptSummary,
  onTranscriptSummaryProgress,
  cutHighlightClip,
  onHighlightCutProgress,
} from '../ipc/subtitles';
import { save as saveFile } from '../ipc/file';
import {
  CREDITS_PER_1K_TOKENS_PROMPT,
  CREDITS_PER_1K_TOKENS_COMPLETION,
} from '../../shared/constants';

// Summary estimation: input tokens ≈ chars/4, output tokens ≈ 20% of input
// High effort (Claude Opus) costs ~4x more than standard (GPT-5.1)
const CLAUDE_OPUS_MULTIPLIER = 4;

function estimateSummaryCredits(
  charCount: number,
  effortLevel: 'standard' | 'high'
): number {
  const inputTokens = Math.ceil(charCount / 4);
  const outputTokens = Math.ceil(inputTokens * 0.2); // Summary is typically ~20% of input
  const baseCredits = Math.ceil(
    (inputTokens / 1000) * CREDITS_PER_1K_TOKENS_PROMPT +
      (outputTokens / 1000) * CREDITS_PER_1K_TOKENS_COMPLETION
  );
  return effortLevel === 'high'
    ? Math.ceil(baseCredits * CLAUDE_OPUS_MULTIPLIER)
    : baseCredits;
}

function formatCredits(credits: number): string {
  if (credits < 1000) return `~${Math.ceil(credits)}`;
  if (credits < 10000) return `~${(credits / 1000).toFixed(1)}k`;
  return `~${Math.round(credits / 1000)}k`;
}

interface TranscriptSummaryPanelProps {
  segments: SrtSegment[];
}

export function TranscriptSummaryPanel({
  segments,
}: TranscriptSummaryPanelProps): JSX.Element | null {
  const { t } = useTranslation();
  const summaryLanguage = useUIStore(s => s.summaryLanguage);
  const setSummaryLanguage = useUIStore(s => s.setSummaryLanguage);
  const summaryEffortLevel = useUIStore(s => s.summaryEffortLevel);

  const [summary, setSummary] = useState<string>('');
  const [highlights, setHighlights] = useState<TranscriptHighlight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
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
  const [highlightCutState, setHighlightCutState] = useState<
    Record<string, HighlightClipCutState>
  >({});
  const [highlightAspectMode, setHighlightAspectMode] =
    useState<HighlightAspectMode>('vertical');
  const mergeHighlightUpdates = useCallback(
    (incoming?: TranscriptHighlight[] | null) => {
      if (!Array.isArray(incoming) || incoming.length === 0) return;
      setHighlights(prev => {
        const map = new Map<string, TranscriptHighlight>();
        prev.forEach(h => map.set(getHighlightKey(h), h));
        incoming.forEach(highlight => {
          const key = getHighlightKey(highlight);
          const existing = map.get(key);
          map.set(key, existing ? { ...existing, ...highlight } : highlight);
        });
        return Array.from(map.values()).sort((a, b) => a.start - b.start);
      });
    },
    []
  );
  const hasSummaryResult = useMemo(
    () => summary.trim().length > 0 || sections.length > 0,
    [summary, sections]
  );
  const transcriptFingerprintRef = useRef<string | null>(null);

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

  const transcriptFingerprint = useMemo(() => {
    if (!segments.length) return 'empty';
    let hash = 0;
    const sampleStep = Math.max(1, Math.floor(segments.length / 25));
    for (let i = 0; i < segments.length; i += sampleStep) {
      const seg = segments[i];
      const start = Number.isFinite(seg.start)
        ? Math.round(seg.start * 1000)
        : 0;
      const end = Number.isFinite(seg.end) ? Math.round(seg.end * 1000) : start;
      const textLength = (seg.original ?? '').length;
      hash = (hash * 31 + start) | 0;
      hash = (hash * 31 + end) | 0;
      hash = (hash * 31 + textLength) | 0;
    }
    return `${segments.length}:${hash}`;
  }, [segments]);

  const hasTranscript = usableSegments.length > 0;
  const videoAvailableForHighlights = Boolean(
    originalVideoPath || fallbackVideoPath
  );

  // Credit balance and summary cost estimation
  const credits = useCreditStore(s => s.credits);
  const summaryEstimate = useMemo(() => {
    if (!hasTranscript) return null;
    const charCount = usableSegments.reduce((acc, seg) => acc + seg.text.length, 0);
    if (charCount === 0) return null;
    const estimatedCredits = estimateSummaryCredits(charCount, summaryEffortLevel);
    return {
      charCount,
      estimatedCredits,
      hasEnoughCredits: credits == null || credits >= estimatedCredits,
    };
  }, [hasTranscript, usableSegments, summaryEffortLevel, credits]);

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
      setProgressLabel(nextLabel);
      setProgressPercent(clampedPercent);

      if (typeof progress.partialSummary === 'string') {
        setSummary(progress.partialSummary.trim());
      }

      if (Array.isArray(progress.partialSections)) {
        setSections(progress.partialSections as TranscriptSummarySection[]);
      }

      if (Array.isArray(progress.partialHighlights)) {
        mergeHighlightUpdates(
          progress.partialHighlights as TranscriptHighlight[]
        );
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
        const stageText = String(progress.stage || '').toLowerCase();
        const highlightStage =
          stageText.includes('highlight') || stageText.includes('punchline');

        if (message === 'insufficient-credits') {
          setError(t('summary.insufficientCredits'));
          useCreditStore
            .getState()
            .refresh()
            .catch(() => void 0);
        } else if (highlightStage) {
          setError(
            t('summary.highlightsSelectionFailed', {
              message,
            })
          );
        } else {
          setError(t('summary.error', { message }));
        }
      }

      if (pct >= 100) {
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
  }, [activeOperationId, t, mergeHighlightUpdates]);

  useEffect(() => {
    const unsubscribe = onHighlightCutProgress(progress => {
      const highlight = progress.highlight as TranscriptHighlight | undefined;
      const highlightId =
        progress.highlightId || (highlight ? getHighlightKey(highlight) : null);
      const pct = typeof progress.percent === 'number' ? progress.percent : 0;
      const clampedPercent = Math.min(100, Math.max(0, pct));
      if (highlightId) {
        setHighlightCutState(prev => {
          const prevState = prev[highlightId] || {
            status: 'idle',
            percent: 0,
          };
          let status: HighlightClipCutState['status'] = prevState.status;
          const stageText = String(progress.stage || '').toLowerCase();
          if (stageText.includes('ready')) {
            status = 'ready';
          } else if (stageText.includes('cancel')) {
            status = 'cancelled';
          } else if (stageText.includes('error')) {
            status = 'error';
          } else if (stageText) {
            status = 'cutting';
          }
          const nextState: HighlightClipCutState = {
            status,
            percent: status === 'ready' ? 100 : clampedPercent,
            error: progress.error || undefined,
            operationId: progress.operationId,
          };
          return {
            ...prev,
            [highlightId]: nextState,
          };
        });
      }

      if (highlight) {
        mergeHighlightUpdates([highlight]);
        const key = getHighlightKey(highlight);
        setDownloadStatus(prev => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }

      if (progress.error) {
        if (progress.error === 'insufficient-credits') {
          setError(t('summary.insufficientCredits'));
          useCreditStore
            .getState()
            .refresh()
            .catch(() => void 0);
        } else {
          setError(
            t('summary.downloadHighlightFailed', {
              message: progress.error,
            })
          );
        }
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [t, mergeHighlightUpdates]);

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
    setHighlightCutState({});
    setDownloadStatus({});
    setCopyStatus('idle');
    setProgressLabel(t('summary.status.preparing'));
    setProgressPercent(0);
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
        includeHighlights: true,
        effortLevel: summaryEffortLevel,
      });

      if (result?.error) {
        throw new Error(result.error);
      }

      if (result?.cancelled || result?.success === false) {
        setProgressLabel(t('summary.status.cancelled'));
        setProgressPercent(prev => Math.max(0, prev));
        useTaskStore.getState().setSummary({
          stage: t('summary.status.cancelled'),
          percent: 0,
          inProgress: false,
          id: null,
        });
        return;
      }

      if (result?.summary) {
        setSummary(result.summary.trim());
      }
      if (Array.isArray(result?.sections)) {
        setSections(result.sections as TranscriptSummarySection[]);
      }
      if (Array.isArray(result?.highlights)) {
        mergeHighlightUpdates(result.highlights as TranscriptHighlight[]);
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
    summaryEffortLevel,
    usableSegments,
    t,
    progressPercent,
    originalVideoPath,
    fallbackVideoPath,
    mergeHighlightUpdates,
  ]);

  const handleDownloadHighlight = useCallback(
    async (highlight: TranscriptHighlight, index: number) => {
      if (!highlight?.videoPath) return;
      const key = getHighlightKey(highlight);

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

  const handleCutHighlightClip = useCallback(
    async (highlight: TranscriptHighlight) => {
      if (!hasSummaryResult) {
        setError(
          t(
            'summary.summaryRequiredForHighlights',
            'Generate a transcript summary before cutting highlight clips.'
          )
        );
        return;
      }

      const videoPath = originalVideoPath || fallbackVideoPath;
      if (!videoPath) {
        setError(
          t(
            'summary.noVideoForHighlights',
            'Open the source video to cut highlight clips.'
          )
        );
        return;
      }

      const key = getHighlightKey(highlight);
      const existingState = highlightCutState[key];
      if (existingState?.status === 'cutting') {
        return;
      }

      const operationId = `highlight-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      setHighlightCutState(prev => ({
        ...prev,
        [key]: { status: 'cutting', percent: 0, operationId },
      }));
      setError(null);

      try {
        const result = await cutHighlightClip({
          videoPath,
          highlight,
          operationId,
          aspectMode: highlightAspectMode,
        });

        if (result?.error) {
          throw new Error(result.error);
        }

        if (result?.cancelled) {
          setHighlightCutState(prev => ({
            ...prev,
            [key]: { status: 'cancelled', percent: 0 },
          }));
          return;
        }

        if (result?.highlight) {
          const updated = result.highlight as TranscriptHighlight;
          setHighlights(prev => {
            const map = new Map<string, TranscriptHighlight>();
            prev.forEach(h => map.set(getHighlightKey(h), h));
            const existing = map.get(key);
            map.set(key, existing ? { ...existing, ...updated } : updated);
            return Array.from(map.values()).sort((a, b) => a.start - b.start);
          });
        }

        setHighlightCutState(prev => ({
          ...prev,
          [key]: { status: 'ready', percent: 100 },
        }));
      } catch (err: any) {
        console.error('[TranscriptSummaryPanel] cut highlight failed', err);
        const message = err?.message || String(err);
        setHighlightCutState(prev => ({
          ...prev,
          [key]: { status: 'error', percent: 0, error: message },
        }));
        setError(
          t('summary.downloadHighlightFailed', {
            message,
          })
        );
      }
    },
    [
      hasSummaryResult,
      originalVideoPath,
      fallbackVideoPath,
      highlightCutState,
      highlightAspectMode,
      t,
    ]
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

  useEffect(() => {
    if (!hasTranscript) {
      transcriptFingerprintRef.current = null;
      setSummary('');
      setSections([]);
      setHighlights([]);
      setDownloadStatus({});
      setHighlightCutState({});
      setCopyStatus('idle');
      setProgressLabel('');
      setProgressPercent(0);
      setError(null);
      return;
    }

    if (transcriptFingerprintRef.current === transcriptFingerprint) {
      return;
    }

    transcriptFingerprintRef.current = transcriptFingerprint;
    setSummary('');
    setSections([]);
    setHighlights([]);
    setDownloadStatus({});
    setHighlightCutState({});
    setCopyStatus('idle');
    setProgressLabel('');
    setProgressPercent(0);
    setError(null);
  }, [
    hasTranscript,
    transcriptFingerprint,
    setSummary,
    setSections,
    setHighlights,
    setDownloadStatus,
    setCopyStatus,
  ]);

  if (!hasTranscript) {
    return null;
  }

  const showProgressBar = isGenerating || activeOperationId !== null;

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
          <div
            className={css`
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 4px;
            `}
          >
            <Button
              variant="primary"
              size="sm"
              onClick={handleGenerate}
              disabled={isGenerating}
              isLoading={isGenerating}
            >
              {summary ? t('summary.regenerate') : t('summary.generate')}
            </Button>
            {summaryEstimate && !isGenerating && (
              <span
                className={css`
                  font-size: 0.75rem;
                  color: ${summaryEstimate.hasEnoughCredits
                    ? colors.gray
                    : colors.danger};
                  text-align: center;
                `}
              >
                {t('summary.estimateCredits', '{{credits}} credits', {
                  credits: formatCredits(summaryEstimate.estimatedCredits),
                })}
                {summaryEffortLevel === 'high' && (
                  <span
                    className={css`
                      color: ${colors.primaryDark};
                      margin-left: 4px;
                    `}
                  >
                    {t('summary.highEffortBadge', '(deep)')}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={tabsRowStyles}>
        <button
          className={tabButtonStyles(activeTab === 'summary')}
          onClick={() => setActiveTab('summary')}
        >
          {t('summary.tab.summary', 'Summary')}
        </button>
        <button
          className={tabButtonStyles(activeTab === 'sections')}
          onClick={() => setActiveTab('sections')}
        >
          {t('summary.tab.sections', 'Detailed notes')}
        </button>
        <button
          className={tabButtonStyles(activeTab === 'highlights')}
          onClick={() => setActiveTab('highlights')}
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
        <div className={highlightsTabStyles}>
          {/* Aspect mode selector */}
          {hasSummaryResult && highlights.length > 0 && (
            <div className={aspectModeRowStyles}>
              <span className={aspectModeLabelStyles}>
                {t('summary.clipFormat', 'Clip format:')}
              </span>
              <div className={aspectModeToggleStyles}>
                <button
                  className={aspectModeButtonStyles(
                    highlightAspectMode === 'vertical'
                  )}
                  onClick={() => setHighlightAspectMode('vertical')}
                  title={t(
                    'summary.verticalFormatDesc',
                    'Optimized for YouTube Shorts, TikTok, Reels (9:16)'
                  )}
                >
                  {t('summary.verticalFormat', '9:16 Vertical')}
                </button>
                <button
                  className={aspectModeButtonStyles(
                    highlightAspectMode === 'original'
                  )}
                  onClick={() => setHighlightAspectMode('original')}
                  title={t(
                    'summary.originalFormatDesc',
                    'Keep original video dimensions'
                  )}
                >
                  {t('summary.originalFormat', 'Original')}
                </button>
              </div>
            </div>
          )}

          {!hasSummaryResult ? (
            <div className={noHighlightsStyles}>
              {t(
                'summary.summaryRequiredForHighlights',
                'Generate a transcript summary before cutting highlight clips.'
              )}
            </div>
          ) : highlights.length === 0 ? (
            <div className={noHighlightsStyles}>
              {t(
                'summary.noHighlights',
                'No highlights yet. Generate to detect punchlines.'
              )}
            </div>
          ) : (
            <div className={highlightsGridStyles}>
              {highlights.map((h, idx) => {
                const statusKey = getHighlightKey(h);
                const downloadState = downloadStatus[statusKey] || 'idle';
                const cutState = highlightCutState[statusKey];
                const cutStatus =
                  cutState?.status || (h.videoPath ? 'ready' : 'idle');
                const cutPercent =
                  typeof cutState?.percent === 'number'
                    ? cutState.percent
                    : h.videoPath
                      ? 100
                      : 0;
                const cutError = cutState?.error;
                const cutDisabled =
                  cutStatus === 'cutting' ||
                  !videoAvailableForHighlights ||
                  isGenerating ||
                  Boolean(activeOperationId);

                return (
                  <div key={statusKey} className={highlightCard}>
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
                      <div className={highlightPlaceholder}>
                        <p className={highlightPlaceholderText}>
                          {t(
                            'summary.highlightPlaceholder',
                            'Clip not yet cut.'
                          )}
                        </p>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleCutHighlightClip(h)}
                          disabled={cutDisabled}
                        >
                          {cutStatus === 'cutting'
                            ? t('summary.cuttingHighlightClip', 'Cutting…')
                            : t(
                                'summary.cutHighlightClip',
                                'Cut this highlight'
                              )}
                        </Button>
                        {cutStatus === 'cutting' && (
                          <div className={highlightCutProgressTrack}>
                            <div
                              className={highlightCutProgressFill}
                              style={{ width: `${cutPercent}%` }}
                            />
                          </div>
                        )}
                        {cutError && (
                          <span className={highlightStatusError}>
                            {cutError}
                          </span>
                        )}
                        {!videoAvailableForHighlights && (
                          <span className={highlightStatusError}>
                            {t(
                              'summary.noVideoForHighlights',
                              'Open the source video to cut highlight clips.'
                            )}
                          </span>
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
                          disabled={downloadState === 'saving'}
                        >
                          {downloadState === 'saving'
                            ? t('summary.downloadingHighlight', 'Saving…')
                            : t('summary.downloadHighlight', 'Download clip')}
                        </Button>
                        {downloadState === 'saved' && (
                          <span className={highlightStatusSuccess}>
                            {t('summary.highlightSaved', 'Saved!')}
                          </span>
                        )}
                        {downloadState === 'error' && (
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
      )}
    </div>
  );
}

function getHighlightKey(h: TranscriptHighlight): string {
  if (typeof h.id === 'string' && h.id.trim().length > 0) {
    return h.id;
  }
  return buildHighlightRangeKey(h);
}

function buildHighlightRangeKey(h: TranscriptHighlight): string {
  const start = Number.isFinite(h.start) ? Math.round(h.start * 1000) : 0;
  const end = Number.isFinite(h.end) ? Math.round(h.end * 1000) : start;
  return `${start}-${end}`;
}

type HighlightClipCutState = {
  status: 'idle' | 'cutting' | 'ready' | 'error' | 'cancelled';
  percent: number;
  error?: string;
  operationId?: string | null;
};

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

  const selectingState =
    (text.includes('selecting') || text.includes('selection')) &&
    text.includes('highlight');
  if (selectingState) {
    return t(
      'summary.status.selectingHighlights',
      'Selecting highlight moments…'
    );
  }
  if (text.includes('cutting') && text.includes('highlight')) {
    const cutMatch = text.match(/cutting\s+highlight\s+(\d+)\s+of\s+(\d+)/);
    if (cutMatch) {
      return t('summary.status.cuttingHighlight', {
        current: Number(cutMatch[1]),
        total: Number(cutMatch[2]),
      });
    }
    return t('summary.status.cuttingHighlights', 'Cutting highlight clips…');
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

const highlightsTabStyles = css`
  display: flex;
  flex-direction: column;
  gap: 12px;
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

const highlightPlaceholder = css`
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: ${colors.dark};
  background: ${colors.grayLight};
  border: 1px dashed ${colors.border};
  border-radius: 6px;
  padding: 12px;
`;

const highlightPlaceholderText = css`
  margin: 0;
  color: ${colors.gray};
`;

const highlightCutProgressTrack = css`
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: ${colors.gray};
  opacity: 0.25;
  overflow: hidden;
`;

const highlightCutProgressFill = css`
  height: 100%;
  background: ${colors.primary};
  transition: width 0.2s ease;
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

const aspectModeRowStyles = css`
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 4px;
`;

const aspectModeLabelStyles = css`
  font-size: 0.85rem;
  font-weight: 500;
  color: ${colors.gray};
`;

const aspectModeToggleStyles = css`
  display: flex;
  gap: 0;
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid ${colors.border};
`;

const aspectModeButtonStyles = (active: boolean) => css`
  border: none;
  background: ${active ? colors.primary : colors.white};
  color: ${active ? colors.white : colors.dark};
  padding: 5px 12px;
  font-size: 0.8rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: ${active ? colors.primary : colors.grayLight};
  }

  &:first-of-type {
    border-right: 1px solid ${colors.border};
  }
`;

export default TranscriptSummaryPanel;

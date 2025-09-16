import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import type { SrtSegment } from '@shared-types/app';
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
import { useUIStore, useTaskStore } from '../state';
import {
  generateTranscriptSummary,
  onTranscriptSummaryProgress,
} from '../ipc/subtitles';

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
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(
    null
  );
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

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
    if (!activeOperationId) return;

    const unsubscribe = onTranscriptSummaryProgress(progress => {
      if (progress.operationId !== activeOperationId) return;
      const nextLabel = translateStageLabel(progress.stage ?? '', t);
      const pct = typeof progress.percent === 'number' ? progress.percent : 0;
      setProgressLabel(nextLabel);
      setProgressPercent(Math.min(100, Math.max(0, pct)));

      if (typeof progress.partialSummary === 'string') {
        setSummary(progress.partialSummary.trim());
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

      if (pct >= 100) {
        setActiveOperationId(null);
        useTaskStore.getState().setSummary({
          stage: t('summary.status.ready'),
          percent: 100,
          inProgress: false,
          id: null,
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
    setSummary('');
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
      });

      if (result?.error) {
        throw new Error(result.error);
      }

      if (result?.summary) {
        setSummary(result.summary.trim());
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
  ]);

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

      {(progressLabel || isGenerating) && (
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

      {summary && (
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
    </div>
  );
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

const panelStyles = css`
  border: 1px solid ${colors.border};
  border-radius: 10px;
  padding: 18px 20px;
  background: ${colors.light};
  display: flex;
  flex-direction: column;
  gap: 16px;
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

const summaryHeaderStyles = css`
  display: flex;
  justify-content: flex-end;
`;

const errorWrapperStyles = css`
  display: flex;
  align-items: center;
`;

export default TranscriptSummaryPanel;

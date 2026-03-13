import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type { SummaryEffortLevel } from '@shared-types/app';
import Button from '../Button';
import {
  TRANSLATION_LANGUAGE_GROUPS,
  TRANSLATION_LANGUAGES_BASE,
} from '../../constants/translation-languages';
import { formatCredits } from './TranscriptSummaryPanel.helpers';
import {
  controlsStyles,
  headerMainStyles,
  headerRowStyles,
  labelStyles,
  summaryEstimateBadgeStyles,
  summaryEstimateStyles,
  summaryEstimateWarningStyles,
  summaryGenerateWrapStyles,
  summarySelectStyles,
  titleStyles,
} from './TranscriptSummaryPanel.styles';

type SummaryEstimate = {
  charCount: number;
  estimatedCredits: number;
  isByo: boolean;
  hasEnoughCredits: boolean;
};

type TranscriptSummaryHeaderProps = {
  isGenerating: boolean;
  isMergeInProgress: boolean;
  isTranslationInProgress: boolean;
  onGenerate: () => void;
  onSummaryLanguageChange: (value: string) => void;
  summary: string;
  summaryEffortLevel: SummaryEffortLevel;
  summaryEstimate: SummaryEstimate | null;
  summaryLanguage: string;
  tabs?: ReactNode;
  t: TFunction;
};

export default function TranscriptSummaryHeader({
  isGenerating,
  isMergeInProgress,
  isTranslationInProgress,
  onGenerate,
  onSummaryLanguageChange,
  summary,
  summaryEffortLevel,
  summaryEstimate,
  summaryLanguage,
  tabs,
  t,
}: TranscriptSummaryHeaderProps) {
  const generateHighlightsLabel = summary.trim()
    ? t('summary.regenerate', 'Regenerate highlights')
    : t('summary.generate', 'Generate highlights');

  return (
    <div className={headerRowStyles}>
      <div className={headerMainStyles}>
        <h3 className={titleStyles}>{t('summary.tab.highlights')}</h3>
        {tabs}
      </div>
      <div className={controlsStyles}>
        <label className={labelStyles}>{t('subtitles.outputLanguage')}</label>
        <select
          className={summarySelectStyles}
          value={summaryLanguage}
          onChange={event => onSummaryLanguageChange(event.target.value)}
          disabled={
            isGenerating || isMergeInProgress || isTranslationInProgress
          }
        >
          {TRANSLATION_LANGUAGES_BASE.map(option => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
          {TRANSLATION_LANGUAGE_GROUPS.map(group => (
            <optgroup key={group.labelKey} label={t(group.labelKey)}>
              {group.options.map(option => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className={summaryGenerateWrapStyles}>
          <Button
            variant="primary"
            size="sm"
            onClick={onGenerate}
            disabled={
              isGenerating || isMergeInProgress || isTranslationInProgress
            }
            isLoading={isGenerating}
          >
            {generateHighlightsLabel}
          </Button>
          {summaryEstimate && !isGenerating ? (
            <span
              className={`${summaryEstimateStyles} ${
                summaryEstimate.hasEnoughCredits
                  ? ''
                  : summaryEstimateWarningStyles
              }`}
            >
              {summaryEstimate.isByo
                ? t('summary.estimateByo', 'BYO key')
                : `${formatCredits(summaryEstimate.estimatedCredits)} cr`}
              {!summaryEstimate.isByo && summaryEffortLevel === 'high' ? (
                <span className={summaryEstimateBadgeStyles}>
                  {t('summary.highEffortBadge', '(deep)')}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

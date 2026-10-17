import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { SummaryEffortLevel } from '@shared-types/app';
import Button from '../Button';
import {
  TRANSLATION_LANGUAGE_GROUPS,
  TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGES_BASE,
} from '../../constants/translation-languages';
import type { RestoredAnalysisVariant } from './useTranscriptSummaryFlow';
import { formatCredits } from './TranscriptSummaryPanel.helpers';
import {
  controlsStyles,
  headerMainStyles,
  headerRowStyles,
  labelStyles,
  restoredNoteStyles,
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

export type TranscriptSummaryView = 'summary' | 'clips';

type TranscriptSummaryHeaderProps = {
  generationLocked?: boolean;
  /** A summary, notes or highlights are showing (from a run or a save). */
  hasResult: boolean;
  restoredVariant: RestoredAnalysisVariant | null;
  /** Which task opened the panel: it names the card and the button. */
  view: TranscriptSummaryView;
  isGenerating: boolean;
  isMergeInProgress: boolean;
  isTranslationInProgress: boolean;
  onGenerate: () => void;
  onSummaryLanguageChange: (value: string) => void;
  summaryEffortLevel: SummaryEffortLevel;
  summaryEstimate: SummaryEstimate | null;
  summaryLanguage: string;
  tabs?: ReactNode;
  t: TFunction;
};

function languageLabel(value: string, t: TFunction): string {
  const option = TRANSLATION_LANGUAGES.find(
    candidate => candidate.value === value.trim().toLowerCase()
  );
  return option ? t(option.labelKey) : value;
}

export default function TranscriptSummaryHeader({
  generationLocked = false,
  hasResult,
  restoredVariant,
  view,
  isGenerating,
  isMergeInProgress,
  isTranslationInProgress,
  onGenerate,
  onSummaryLanguageChange,
  summaryEffortLevel,
  summaryEstimate,
  summaryLanguage,
  tabs,
  t,
}: TranscriptSummaryHeaderProps) {
  const { i18n } = useTranslation();
  // One run writes the summary, the notes and the highlights; the label
  // names what the user came here for.
  const generateLabel =
    view === 'summary'
      ? hasResult
        ? t('summary.regenerateSummary', 'Summarize again')
        : t('summary.generateSummary', 'Summarize')
      : hasResult
        ? t('summary.regenerate', 'Regenerate highlights')
        : t('summary.generate', 'Generate highlights');
  const areControlsLocked =
    generationLocked ||
    isGenerating ||
    isMergeInProgress ||
    isTranslationInProgress;

  return (
    <div className={headerRowStyles}>
      <div className={headerMainStyles}>
        <h3 className={titleStyles}>
          {view === 'summary'
            ? t('summary.tab.summary', 'Summary')
            : t('summary.tab.highlights', 'Highlights')}
        </h3>
        {tabs}
      </div>
      <div className={controlsStyles}>
        <label className={labelStyles}>{t('subtitles.outputLanguage')}</label>
        <select
          className={summarySelectStyles}
          value={summaryLanguage}
          onChange={event => onSummaryLanguageChange(event.target.value)}
          disabled={areControlsLocked}
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
            // Once there is a result, regenerating is the quiet option.
            variant={hasResult ? 'secondary' : 'primary'}
            size="sm"
            onClick={onGenerate}
            disabled={areControlsLocked}
            isLoading={isGenerating}
          >
            {generateLabel}
          </Button>
          {summaryEstimate && !isGenerating ? (
            <span
              className={`${summaryEstimateStyles} ${
                summaryEstimate.hasEnoughCredits
                  ? ''
                  : summaryEstimateWarningStyles
              }`}
            >
              {summaryEstimate.isByo ? (
                t('summary.estimateOwnKey', 'Uses your API key')
              ) : (
                <bdi>
                  {t('credits.estimateAmount', '{{credits}} credits', {
                    credits: formatCredits(
                      summaryEstimate.estimatedCredits,
                      i18n.language
                    ),
                  })}
                </bdi>
              )}
              {!summaryEstimate.isByo && summaryEffortLevel === 'high' ? (
                <span className={summaryEstimateBadgeStyles}>
                  {t('summary.highEffortBadge', '(deep)')}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
      {restoredVariant && hasResult ? (
        <p className={restoredNoteStyles} role="note">
          {restoredVariant.effortLevel === summaryEffortLevel
            ? t('summary.showingSavedLanguage', {
                defaultValue:
                  'Showing the saved result in {{language}}. Press the button to make one in {{current}}.',
                language: languageLabel(restoredVariant.summaryLanguage, t),
                current: languageLabel(summaryLanguage, t),
              })
            : t('summary.showingSavedVariant', {
                defaultValue:
                  'Showing the saved result in {{language}}, made at a different summary quality. Press the button to make a new one.',
                language: languageLabel(restoredVariant.summaryLanguage, t),
              })}
        </p>
      ) : null}
    </div>
  );
}

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
import { useCreditStore, useUIStore } from '../../state';
import { logButton } from '../../utils/logger';
import { formatCostOfBalanceInMinutes } from '../../utils/formatCostInMinutes';
import {
  intoLanguageName,
  sentenceLanguageName,
} from '../../utils/languageName';
import {
  controlsStyles,
  headerMainStyles,
  headerRowStyles,
  labelStyles,
  qualitySelectStyles,
  restoredNoteStyles,
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
  onSummaryEffortLevelChange: (value: SummaryEffortLevel) => void;
  summaryEffortLevel: SummaryEffortLevel;
  summaryEstimate: SummaryEstimate | null;
  summaryLanguage: string;
  tabs?: ReactNode;
  t: TFunction;
};

/** A language name for a sentence, plus its "into X" form. */
function languageInSentence(
  value: string,
  t: TFunction,
  uiLanguage: string
): { name: string; into: string } {
  const code = value.trim().toLowerCase();
  const option = TRANSLATION_LANGUAGES.find(
    candidate => candidate.value === code
  );
  const name = sentenceLanguageName(
    option ? t(option.labelKey) : value,
    uiLanguage
  );
  return { name, into: intoLanguageName(code, name, uiLanguage) };
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
  onSummaryEffortLevelChange,
  summaryEffortLevel,
  summaryEstimate,
  summaryLanguage,
  tabs,
  t,
}: TranscriptSummaryHeaderProps) {
  const { i18n } = useTranslation();
  const uiLanguage = i18n.language;
  const credits = useCreditStore(state => state.credits);
  // Like Dub and Translate: when the balance can't cover the run, the next
  // step is getting minutes, not a run that stops at once.
  const shortOfCredits = Boolean(
    summaryEstimate &&
    !summaryEstimate.isByo &&
    !summaryEstimate.hasEnoughCredits
  );
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
  const addCreditsLabel =
    view === 'summary'
      ? t('summary.addMinutesToSummarize', 'Add minutes to summarize')
      : t('summary.addMinutesForHighlights', 'Add minutes to find highlights');
  const savedLanguage = restoredVariant
    ? languageInSentence(restoredVariant.summaryLanguage, t, uiLanguage)
    : null;
  const currentLanguage = languageInSentence(summaryLanguage, t, uiLanguage);
  const savedInOtherVariant = Boolean(
    restoredVariant &&
    (restoredVariant.summaryLanguage !== summaryLanguage.trim().toLowerCase() ||
      restoredVariant.effortLevel !== summaryEffortLevel)
  );
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
        <label className={labelStyles} htmlFor="summary-quality-select">
          {t('summary.qualityLabel', 'Quality')}
        </label>
        <select
          id="summary-quality-select"
          className={qualitySelectStyles}
          value={summaryEffortLevel}
          onChange={event =>
            onSummaryEffortLevelChange(
              event.target.value === 'high' ? 'high' : 'standard'
            )
          }
          disabled={areControlsLocked}
        >
          <option value="standard">
            {t('summary.qualityStandard', 'Standard')}
          </option>
          <option value="high">
            {t('summary.qualityDeep', 'Deep (costs more)')}
          </option>
        </select>
        <div className={summaryGenerateWrapStyles}>
          {shortOfCredits && !isGenerating ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                logButton('summary_panel_add_credits', { view });
                useUIStore.getState().toggleSettings(true);
              }}
            >
              {addCreditsLabel}
            </Button>
          ) : (
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
          )}
          {summaryEstimate && !isGenerating ? (
            <div
              className={`${summaryEstimateStyles} ${
                shortOfCredits ? summaryEstimateWarningStyles : ''
              }`}
            >
              {summaryEstimate.isByo ? (
                t('summary.estimateOwnKey', 'Uses your API key')
              ) : (
                <bdi>
                  {formatCostOfBalanceInMinutes(
                    t,
                    summaryEstimate.estimatedCredits,
                    credits,
                    uiLanguage
                  )}
                </bdi>
              )}
              {shortOfCredits ? (
                // Same as Dub and Translate: the shortfall in words, on its
                // own line, and only it is announced.
                <div role="alert">
                  {view === 'summary'
                    ? t(
                        'summary.notEnoughMinutesSummary',
                        'Not enough minutes left for this summary.'
                      )
                    : t(
                        'summary.notEnoughMinutesHighlights',
                        'Not enough minutes left to find highlights.'
                      )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {restoredVariant && hasResult && restoredVariant.transcriptChanged ? (
        <p className={restoredNoteStyles} role="note">
          {t(
            'summary.subtitlesChangedSinceAnalysis',
            'The subtitles changed since this was made. Highlights whose lines changed are marked; the rest still match.'
          )}
        </p>
      ) : null}
      {restoredVariant && hasResult && savedInOtherVariant && savedLanguage ? (
        <p className={restoredNoteStyles} role="note">
          {restoredVariant.effortLevel === summaryEffortLevel
            ? t('summary.showingSavedLanguage', {
                defaultValue:
                  'Showing the saved result in {{language}}. Press the button to make one in {{current}}.',
                language: savedLanguage.name,
                languageInto: savedLanguage.into,
                current: currentLanguage.name,
                currentInto: currentLanguage.into,
              })
            : t('summary.showingSavedVariant', {
                defaultValue:
                  'Showing the saved result in {{language}}, made at a different summary quality. Press the button to make a new one.',
                language: savedLanguage.name,
                languageInto: savedLanguage.into,
              })}
        </p>
      ) : null}
    </div>
  );
}

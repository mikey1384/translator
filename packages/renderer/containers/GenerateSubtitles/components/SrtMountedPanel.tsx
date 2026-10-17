import { useEffect, useMemo, useState } from 'react';
import { css, cx } from '@emotion/css';
import { FileCheck2 } from 'lucide-react';
import type { SubtitleDisplayMode } from '@shared-types/app';
import { selectStyles } from '../../../styles.js';
import { useTranslation } from 'react-i18next';
import Button from '../../../components/Button.js';
import { useUIStore } from '../../../state/ui-store';
import { useSubStore } from '../../../state/subtitle-store';
import { detectTextLanguage } from '../../../utils/detectTextLanguage';
import {
  TRANSLATION_LANGUAGES_BASE,
  TRANSLATION_LANGUAGE_GROUPS,
} from '../../../constants/translation-languages';
import { useTaskStore } from '../../../state/task-store';
import { useUrlStore } from '../../../state/url-store';
import { useCreditCostEstimates } from '../../../hooks/useCreditCostEstimates';
import { formatCostInMinutes } from '../../../utils/formatCostInMinutes';
import { useDubEstimate } from '../../../hooks/useDubEstimate';
import { TTS_CREDITS_PER_MINUTE } from '../../../../shared/constants';
import {
  workflowPanelActionGroupStyles,
  workflowPanelBadgeStyles,
  workflowPanelControlsStyles,
  workflowPanelCostStyles,
  workflowPanelCostWarningStyles,
  workflowPanelInlineFieldStyles,
  workflowPanelLeadIconStyles,
  workflowPanelLeadIconSuccessStyles,
  workflowPanelLeadStyles,
  workflowPanelMetaStyles,
  workflowPanelStyles,
  workflowPanelSuccessStyles,
  workflowPanelTextBlockStyles,
  workflowPanelTitleStyles,
} from '../../../components/workflow-surface-styles';

const costWarningLineStyles = css`
  display: block;
`;

interface SrtMountedPanelProps {
  srtPath?: string | null;
  onTranslate?: () => void;
  isTranslating?: boolean;
  onDub?: () => void;
  isDubbing?: boolean;
  disabled?: boolean;
  targetLanguage?: string;
  onTargetLanguageChange?: (lang: string) => void;
  disableDub?: boolean;
  className?: string;
  /**
   * Opened as "Translate to another language": the user picks a language
   * the lines aren't already in before Translate is offered.
   */
  pickAnotherLanguage?: boolean;
}

export default function SrtMountedPanel({
  srtPath,
  onTranslate,
  isTranslating = false,
  onDub,
  isDubbing = false,
  disabled = false,
  targetLanguage,
  onTargetLanguageChange,
  disableDub = false,
  className,
  pickAnotherLanguage = false,
}: SrtMountedPanelProps) {
  const { t, i18n } = useTranslation();
  const order = useSubStore(s => s.order);
  const segments = useSubStore(s => s.segments);
  // The languages the lines are already in: no point translating into them.
  const presentLanguages = useMemo(() => {
    if (!pickAnotherLanguage) return new Set<string>();
    const originals: string[] = [];
    const translations: string[] = [];
    for (const id of order) {
      const seg = segments[id];
      if (seg?.original?.trim()) originals.push(seg.original);
      if (seg?.translation?.trim()) translations.push(seg.translation);
    }
    return new Set(
      [detectTextLanguage(originals), detectTextLanguage(translations)].filter(
        (value): value is string => Boolean(value)
      )
    );
  }, [pickAnotherLanguage, order, segments]);
  const [pickedLanguage, setPickedLanguage] = useState('');
  useEffect(() => {
    if (!pickAnotherLanguage) setPickedLanguage('');
  }, [pickAnotherLanguage]);
  const languageNeeded = pickAnotherLanguage && !pickedLanguage;
  // The Translate view is about translating: no Dub button or dub warnings
  // there (Dub has its own view).
  const showDub = Boolean(onDub) && !pickAnotherLanguage;
  const subtitleDisplayMode = useUIStore(s => s.subtitleDisplayMode);
  const setSubtitleDisplayMode = useUIStore(s => s.setSubtitleDisplayMode);
  const isTranscribing = useTaskStore(s => !!s.transcription.inProgress);
  const isTranslationTaskActive = useTaskStore(s => !!s.translation.inProgress);
  const isMergeInProgress = useTaskStore(s => !!s.merge.inProgress);
  const isSummaryInProgress = useTaskStore(s => !!s.summary.inProgress);
  const isDownloadInProgress = useUrlStore(s => s.download.inProgress);
  const isTranslationBusy = isTranslating || isTranslationTaskActive;
  const isDisabled =
    disabled ||
    isTranslationBusy ||
    isTranscribing ||
    isMergeInProgress ||
    isSummaryInProgress;
  // What Dub really costs, including the translation it runs first.
  const { estimate: dubEstimate } = useDubEstimate();
  const cannotAffordDub = Boolean(
    dubEstimate && !dubEstimate.blocked && !dubEstimate.hasEnoughCredits
  );
  const isDubDisabled =
    disabled ||
    disableDub ||
    isTranscribing ||
    isTranslationBusy ||
    isDubbing ||
    isMergeInProgress ||
    isSummaryInProgress ||
    isDownloadInProgress ||
    cannotAffordDub;

  const { dubbingEstimate, translationEstimate, formatCostLabel } =
    useCreditCostEstimates();

  const cannotAffordTranslation = Boolean(
    translationEstimate &&
    !translationEstimate.isByo &&
    !translationEstimate.hasEnoughCredits &&
    !isTranslating
  );

  const translationCostClassName = cx(
    workflowPanelCostStyles,
    translationEstimate && !translationEstimate.hasEnoughCredits
      ? workflowPanelCostWarningStyles
      : undefined
  );

  const dubbingCostClassName = cx(
    workflowPanelCostStyles,
    (dubbingEstimate && !dubbingEstimate.hasEnoughCredits) || cannotAffordDub
      ? workflowPanelCostWarningStyles
      : undefined
  );

  return (
    <div
      className={cx(workflowPanelStyles, workflowPanelSuccessStyles, className)}
    >
      <div className={workflowPanelLeadStyles}>
        <div
          className={cx(
            workflowPanelLeadIconStyles,
            workflowPanelLeadIconSuccessStyles
          )}
          aria-hidden="true"
        >
          <FileCheck2 size={18} strokeWidth={2.2} />
        </div>
        <div className={workflowPanelTextBlockStyles}>
          <h3 className={workflowPanelTitleStyles}>
            {pickAnotherLanguage
              ? t('input.translateTheseSubtitles', 'Translate these subtitles')
              : srtPath
                ? t('input.subtitlesLoaded', 'Subtitles loaded')
                : t('input.srtLoaded', 'Transcription Complete')}
          </h3>
          {srtPath && (
            <p className={workflowPanelMetaStyles}>
              {srtPath.split(/[/\\]/).pop()}
            </p>
          )}
        </div>
      </div>

      <div className={workflowPanelControlsStyles}>
        <div className={workflowPanelInlineFieldStyles}>
          <label htmlFor="output-language-select">
            {t('subtitles.outputLanguage')}
          </label>
          <select
            id="output-language-select"
            className={selectStyles}
            value={pickAnotherLanguage ? pickedLanguage : targetLanguage}
            onChange={e => {
              setPickedLanguage(e.target.value);
              onTargetLanguageChange?.(e.target.value);
            }}
            disabled={isDisabled}
          >
            {pickAnotherLanguage ? (
              <option value="" disabled>
                {t('input.chooseLanguage', 'Choose a language')}
              </option>
            ) : null}
            {TRANSLATION_LANGUAGES_BASE.filter(
              opt => !presentLanguages.has(opt.value)
            ).map(opt => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
            {TRANSLATION_LANGUAGE_GROUPS.map(group => (
              <optgroup key={group.labelKey} label={t(group.labelKey)}>
                {group.options
                  .filter(opt => !presentLanguages.has(opt.value))
                  .map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className={workflowPanelInlineFieldStyles}>
          <label htmlFor="subtitle-display-mode-select">
            {t('subtitles.displayModeLabel', 'Subtitle display')}
          </label>
          <select
            id="subtitle-display-mode-select"
            className={selectStyles}
            value={subtitleDisplayMode}
            onChange={e =>
              setSubtitleDisplayMode(e.target.value as SubtitleDisplayMode)
            }
            disabled={isDisabled}
          >
            <option value="original">
              {t('editSubtitles.workspace.originalLabel', 'Original')}
            </option>
            <option value="translation">
              {t(
                'editSubtitles.workspace.translationMode',
                'Translation-only mode'
              )}
            </option>
            <option value="dual">
              {t('editSubtitles.workspace.dualMode', 'Dual text mode')}
            </option>
          </select>
        </div>

        <div className={workflowPanelActionGroupStyles}>
          {cannotAffordTranslation ? (
            // Not enough credits: the next step is getting some, not a
            // translation that would stop at once.
            <Button
              variant="primary"
              size="md"
              onClick={() => useUIStore.getState().toggleSettings(true)}
              disabled={isDisabled}
            >
              {t('subtitles.addMinutesToTranslate', 'Add minutes to translate')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={onTranslate}
              disabled={isDisabled || languageNeeded}
              isLoading={isTranslating}
            >
              {t('subtitles.translate', 'Translate')}
            </Button>
          )}
          {translationEstimate &&
            !isTranslating &&
            !translationEstimate.isByo && (
              <span className={translationCostClassName}>
                <bdi>
                  {formatCostLabel(translationEstimate.estimatedCredits)}
                </bdi>
                {translationEstimate.qualityEnabled && (
                  <span className={workflowPanelBadgeStyles}>
                    {t('subtitles.qualityBadge', '(hq)')}
                  </span>
                )}
              </span>
            )}
        </div>

        {showDub ? (
          <div className={workflowPanelActionGroupStyles}>
            <Button
              variant="secondary"
              size="md"
              onClick={onDub}
              disabled={isDubDisabled}
              isLoading={isDubbing}
            >
              {t('subtitles.dub', 'Dub Voice')}
            </Button>
            {dubbingEstimate && !isDubbing && !dubbingEstimate.isByo && (
              <span
                className={dubbingCostClassName}
                title={
                  dubbingEstimate.blockedInApiKeyMode
                    ? t(
                        'settings.byoPreferences.dubbingRequiresElevenLabs',
                        'Dubbing uses ElevenLabs only. Add an ElevenLabs API key to dub with your own keys. Without one, dubbing uses your Stage5 minutes, which aren’t used while your own keys are on.'
                      )
                    : t(
                        'subtitles.dubCostHintMinutes',
                        'ElevenLabs voice: ~{{time}} of your minutes per minute of speech. This estimate is shown before dubbing starts.',
                        {
                          // The copy carries the "~"; exact avoids "~~".
                          time: formatCostInMinutes(
                            TTS_CREDITS_PER_MINUTE.elevenlabs,
                            { kind: 'exact', locale: i18n.language }
                          ),
                        }
                      )
                }
              >
                <bdi>
                  {dubbingEstimate.blockedInApiKeyMode
                    ? 'ElevenLabs'
                    : formatCostLabel(
                        dubEstimate?.total ?? dubbingEstimate.estimatedCredits
                      )}
                </bdi>
                {cannotAffordDub ? (
                  // Its own line, so cost and warning never run together.
                  <span className={costWarningLineStyles}>
                    {t(
                      'subtitles.dubNotEnoughMinutes',
                      'Not enough minutes left for this dub.'
                    )}
                  </span>
                ) : null}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

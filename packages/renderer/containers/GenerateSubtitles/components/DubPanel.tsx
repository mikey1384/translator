import type { ReactNode } from 'react';
import { css, cx } from '@emotion/css';
import { AudioLines, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../../../components/Button.js';
import { colors, selectStyles } from '../../../styles.js';
import {
  fontSize,
  fontWeight,
  spacing,
} from '../../../components/design-system/tokens.js';
import {
  TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGES_BASE,
  TRANSLATION_LANGUAGE_GROUPS,
} from '../../../constants/translation-languages';
import DubbingVoiceSelector from '../../SettingsPage/DubbingVoiceSelector';
import DubbingMixSlider from '../../SettingsPage/DubbingMixSlider';
import { useTaskStore, useUIStore, useVideoStore } from '../../../state';
import { useUrlStore } from '../../../state/url-store';
import { useCreditCostEstimates } from '../../../hooks/useCreditCostEstimates';
import { useDubEstimate } from '../../../hooks/useDubEstimate';
import { saveDubbedVideoFile } from '../../../utils/saveVideo';
import { logButton } from '../../../utils/logger';
import {
  intoLanguageName,
  sentenceLanguageName,
} from '../../../utils/languageName';
import {
  workflowPanelCostStyles,
  workflowPanelCostWarningStyles,
  workflowPanelFlushStyles,
  workflowPanelHintStyles,
  workflowPanelLeadIconStyles,
  workflowPanelLeadStyles,
  workflowPanelStyles,
  workflowPanelTextBlockStyles,
} from '../../../components/workflow-surface-styles';

const panelStackStyles = css`
  flex-direction: column;
  align-items: stretch;
  gap: ${spacing.lg};
`;

const fieldStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
  color: ${colors.text};
  font-weight: ${fontWeight.semibold};
  font-size: ${fontSize.sm};
`;

const actionRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.sm} ${spacing.md};
`;

const costLineStyles = css`
  text-align: start;
`;

const resultStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.sm};
  padding-top: ${spacing.md};
  border-top: 1px solid ${colors.border};
`;

function languageLabel(
  value: string,
  t: (key: string) => string
): string | null {
  const option = TRANSLATION_LANGUAGES.find(
    candidate => candidate.value === value
  );
  return option ? t(option.labelKey) : null;
}

interface DubPanelProps {
  onDub: () => void;
  /** Another job holds the pipeline (transcribing, exporting, …). */
  disabled?: boolean;
  /** Shown instead of the dub controls while there are no subtitles yet. */
  transcribeSlot?: ReactNode;
  className?: string;
}

/**
 * The "Dub it" view: language, voice, ambient mix, one Dub button with what
 * it really costs (a translation first when one is needed), and, once there
 * is a dub, saving it and switching the audio.
 */
export default function DubPanel({
  onDub,
  disabled = false,
  transcribeSlot,
  className,
}: DubPanelProps) {
  const { t, i18n } = useTranslation();
  const targetLanguage = useUIStore(s => s.targetLanguage);
  const setTargetLanguage = useUIStore(s => s.chooseTargetLanguage);
  const dubVoice = useUIStore(s => s.dubVoice);
  const isDubbing = useTaskStore(s => !!s.dubbing.inProgress);
  const isTranslating = useTaskStore(s => !!s.translation.inProgress);
  const isTranscribing = useTaskStore(s => !!s.transcription.inProgress);
  const isMerging = useTaskStore(s => !!s.merge.inProgress);
  const isSummarizing = useTaskStore(s => !!s.summary.inProgress);
  const isDownloading = useUrlStore(s => s.download.inProgress);
  const dubbedVideoPath = useVideoStore(s => s.dubbedVideoPath);
  const hasDubbedTrack = useVideoStore(s => !!s.dubbedUrl);
  const activeTrack = useVideoStore(s => s.activeTrack);
  const originalVideoPath = useVideoStore(s => s.originalPath);
  const videoPath = useVideoStore(s => s.path);
  const { formatCostLabel } = useCreditCostEstimates();

  const { estimate, hasSubtitles, plan } = useDubEstimate();

  const busy =
    disabled ||
    isDubbing ||
    isTranslating ||
    isTranscribing ||
    isMerging ||
    isSummarizing ||
    isDownloading;
  // Sentences need the language as it reads mid-sentence, and the "into X"
  // form for UI languages that inflect it.
  const targetName = sentenceLanguageName(
    languageLabel(targetLanguage, t) ?? targetLanguage,
    i18n.language
  );
  const languageValues = {
    language: targetName,
    languageInto: intoLanguageName(targetLanguage, targetName, i18n.language),
  };
  const dubLabel = t('subtitles.dubInto', {
    defaultValue: 'Dub into {{language}}',
    ...languageValues,
  });
  const shortOfCredits = Boolean(
    estimate && !estimate.blocked && !estimate.hasEnoughCredits
  );

  return (
    <div
      className={cx(
        workflowPanelStyles,
        workflowPanelFlushStyles,
        panelStackStyles,
        className
      )}
      data-testid="workspace-dub-panel"
    >
      <div className={workflowPanelLeadStyles}>
        <div className={workflowPanelLeadIconStyles} aria-hidden="true">
          <AudioLines size={18} strokeWidth={2.2} />
        </div>
        <div className={workflowPanelTextBlockStyles}>
          <p className={workflowPanelHintStyles}>
            {hasSubtitles
              ? t(
                  'subtitles.dubIntro',
                  'A voice reads the subtitles in the language you pick, over the original background sound.'
                )
              : t(
                  'subtitles.dubNeedsSubtitles',
                  'Dubbing reads the subtitles aloud, so this video needs subtitles first. Transcribe it, then pick a voice here.'
                )}
          </p>
        </div>
      </div>

      {!hasSubtitles ? (
        transcribeSlot
      ) : (
        <>
          <label className={fieldStyles}>
            {t('subtitles.dubLanguageLabel', 'Language of the voice')}
            <select
              className={selectStyles}
              value={targetLanguage}
              onChange={event => setTargetLanguage(event.target.value)}
              disabled={busy}
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
            <span className={workflowPanelHintStyles}>
              {plan === 'use-original'
                ? t('subtitles.dubSameLanguage', {
                    defaultValue:
                      'The subtitles are already in {{language}}, so the voice reads them as they are.',
                    ...languageValues,
                  })
                : plan === 'translate'
                  ? t('subtitles.dubTranslatesFirst', {
                      defaultValue:
                        'The subtitles are translated into {{language}} first, then voiced.',
                      ...languageValues,
                    })
                  : null}
            </span>
          </label>

          <DubbingVoiceSelector
            helpText={t(
              'subtitles.dubVoiceHelp',
              'The voice for this dub. It stays chosen for your next dubs.'
            )}
          />
          <DubbingMixSlider />

          <div className={actionRowStyles}>
            {shortOfCredits ? (
              // Not enough credits: the next step is getting some, not a dub
              // that would stop at once.
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  logButton('workspace_dub_view_add_credits');
                  useUIStore.getState().toggleSettings(true);
                }}
              >
                {t('subtitles.addMinutesToDub', 'Add minutes to dub')}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  logButton('workspace_dub_view_dub', { plan });
                  onDub();
                }}
                disabled={busy || Boolean(estimate?.blocked)}
                isLoading={isDubbing || (isTranslating && plan === 'translate')}
              >
                {dubLabel}
              </Button>
            )}
          </div>
          {estimate && !isDubbing ? (
            <div
              className={cx(
                workflowPanelCostStyles,
                costLineStyles,
                (shortOfCredits || estimate.blocked) &&
                  workflowPanelCostWarningStyles
              )}
              role={shortOfCredits || estimate.blocked ? 'alert' : undefined}
            >
              {estimate.blocked ? (
                t(
                  'settings.byoPreferences.dubbingRequiresElevenLabs',
                  'Dubbing uses ElevenLabs only. Add an ElevenLabs API key to dub with your own keys. Without one, dubbing uses your Stage5 minutes, which aren’t used while your own keys are on.'
                )
              ) : estimate.free ? (
                t('subtitles.dubUsesOwnKeys', 'Uses your own API keys.')
              ) : (
                <bdi>
                  {plan === 'translate'
                    ? t('subtitles.dubCostWithTranslation', {
                        defaultValue: 'Translation and voice: {{cost}}',
                        cost: formatCostLabel(estimate.total),
                      })
                    : formatCostLabel(estimate.total)}
                </bdi>
              )}
              {shortOfCredits ? (
                // Its own line: run together with the cost (and in RTL)
                // the two read as one garbled sentence.
                <div>
                  {t(
                    'subtitles.dubNotEnoughMinutes',
                    'Not enough minutes left for this dub.'
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {hasDubbedTrack || dubbedVideoPath ? (
        <div className={resultStyles}>
          {hasDubbedTrack ? (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<AudioLines size={15} aria-hidden="true" />}
              onClick={() => {
                void useVideoStore
                  .getState()
                  .setActiveTrack(
                    activeTrack === 'dubbed' ? 'original' : 'dubbed'
                  )
                  .catch(err =>
                    console.error('[DubPanel] audio switch failed:', err)
                  );
              }}
            >
              {activeTrack === 'dubbed'
                ? t('videoPlayer.useOriginalAudio', 'Use Original Audio')
                : t('videoPlayer.useDubbedAudio', 'Use Dubbed Audio')}
            </Button>
          ) : null}
          {dubbedVideoPath ? (
            <Button
              size="sm"
              variant="primary"
              leftIcon={<Save size={15} aria-hidden="true" />}
              disabled={isDubbing}
              onClick={() => {
                logButton('workspace_dub_view_save');
                void saveDubbedVideoFile({
                  dubbedVideoPath,
                  sourceVideoPath: originalVideoPath ?? videoPath,
                  dubVoice,
                });
              }}
            >
              {t('input.saveDubbedVideo')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

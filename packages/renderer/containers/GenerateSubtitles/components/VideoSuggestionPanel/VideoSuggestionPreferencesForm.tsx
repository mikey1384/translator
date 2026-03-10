import type { TFunction } from 'i18next';
import type { VideoSuggestionRecency } from '@shared-types/app';
import {
  contextToggleCheckboxStyles,
  contextToggleGridStyles,
  contextToggleHintStyles,
  contextToggleLabelStyles,
  contextToggleTextBlockStyles,
  contextToggleTitleStyles,
  countryControlStyles,
  countryHintStyles,
  countryLabelStyles,
  inputStyles,
  preferenceFieldStyles,
  preferenceLabelRowStyles,
  preferencesGridStyles,
  preferenceRemoveButtonStyles,
} from './VideoSuggestionPanel.styles.js';

type Option = {
  label: string;
  value: string;
};

type RecencyOption = {
  label: string;
  value: VideoSuggestionRecency;
};

type VideoSuggestionPreferencesFormProps = {
  disabled: boolean;
  loading: boolean;
  onCountryBlur: (value: string) => void;
  onCountryChange: (value: string) => void;
  onRecencyChange: (value: VideoSuggestionRecency) => void;
  onIncludeDownloadHistoryChange: (value: boolean) => void;
  onIncludeWatchedChannelsChange: (value: boolean) => void;
  onRemoveSavedTopic: () => void;
  onTopicChange: (value: string) => void;
  canRemoveSavedTopic: boolean;
  recencyOptions: RecencyOption[];
  includeDownloadHistory: boolean;
  includeWatchedChannels: boolean;
  sanitizedTopic: string;
  t: TFunction;
  targetCountry: string;
  targetRecency: VideoSuggestionRecency;
  topicSelectOptions: Option[];
};

export default function VideoSuggestionPreferencesForm({
  disabled,
  loading,
  onCountryBlur,
  onCountryChange,
  onRecencyChange,
  onIncludeDownloadHistoryChange,
  onIncludeWatchedChannelsChange,
  onRemoveSavedTopic,
  onTopicChange,
  canRemoveSavedTopic,
  recencyOptions,
  includeDownloadHistory,
  includeWatchedChannels,
  sanitizedTopic,
  t,
  targetCountry,
  targetRecency,
  topicSelectOptions,
}: VideoSuggestionPreferencesFormProps) {
  const showTopicPreference = topicSelectOptions.length > 0;

  return (
    <div className={countryControlStyles}>
      <div className={preferencesGridStyles}>
        <div className={preferenceFieldStyles}>
          <label
            htmlFor="video-suggestion-country"
            className={countryLabelStyles}
          >
            {t('input.videoSuggestion.countryBiasLabel', 'Regional bias')}
          </label>
          <input
            id="video-suggestion-country"
            type="text"
            value={targetCountry}
            onChange={event => onCountryChange(event.target.value.slice(0, 60))}
            onBlur={event => onCountryBlur(event.target.value)}
            placeholder={t(
              'input.videoSuggestion.countryPlaceholder',
              'e.g. US, Japan, Spain, Brazil'
            )}
            className={inputStyles}
            disabled={disabled}
            autoComplete="country-name"
          />
          <div className={countryHintStyles}>
            {t(
              'input.videoSuggestion.countryBiasHint',
              'Leave blank for no regional bias.'
            )}
          </div>
        </div>

        <div className={preferenceFieldStyles}>
          <label
            htmlFor="video-suggestion-recency"
            className={countryLabelStyles}
          >
            {t('input.videoSuggestion.recencyLabel', 'Recency')}
          </label>
          <select
            id="video-suggestion-recency"
            value={targetRecency}
            onChange={event =>
              onRecencyChange(event.target.value as VideoSuggestionRecency)
            }
            className={inputStyles}
            disabled={disabled || loading}
          >
            {recencyOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className={countryHintStyles}>
            {t(
              'input.videoSuggestion.recencyHint',
              'Use this when you want newer videos to rank higher.'
            )}
          </div>
        </div>
      </div>

      {showTopicPreference ? (
        <div className={preferenceFieldStyles}>
          <div className={preferenceLabelRowStyles}>
            <label
              htmlFor="video-suggestion-topic"
              className={countryLabelStyles}
            >
              {t('input.videoSuggestion.preference.topicLabel', 'Preferred topic')}
            </label>
            {canRemoveSavedTopic ? (
              <button
                type="button"
                className={preferenceRemoveButtonStyles}
                onClick={() => onRemoveSavedTopic()}
                disabled={disabled || loading}
              >
                {t('input.videoSuggestion.preference.removeSaved', 'Remove saved')}
              </button>
            ) : null}
          </div>
          <select
            id="video-suggestion-topic"
            value={sanitizedTopic || ''}
            onChange={event => onTopicChange(event.target.value)}
            className={inputStyles}
            disabled={disabled || loading}
          >
            {topicSelectOptions.map(option => (
              <option key={option.value || 'none'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className={contextToggleGridStyles}>
        <label className={contextToggleLabelStyles}>
          <input
            type="checkbox"
            className={contextToggleCheckboxStyles}
            checked={includeDownloadHistory}
            onChange={event =>
              onIncludeDownloadHistoryChange(event.target.checked)
            }
            disabled={disabled || loading}
          />
          <div className={contextToggleTextBlockStyles}>
            <div className={contextToggleTitleStyles}>
              {t(
                'input.videoSuggestion.includeDownloadHistoryLabel',
                'Include my download history'
              )}
            </div>
            <div className={contextToggleHintStyles}>
              {t(
                'input.videoSuggestion.includeDownloadHistoryHint',
                'Let AI use your recent downloaded video titles as soft context.'
              )}
            </div>
          </div>
        </label>

        <label className={contextToggleLabelStyles}>
          <input
            type="checkbox"
            className={contextToggleCheckboxStyles}
            checked={includeWatchedChannels}
            onChange={event =>
              onIncludeWatchedChannelsChange(event.target.checked)
            }
            disabled={disabled || loading}
          />
          <div className={contextToggleTextBlockStyles}>
            <div className={contextToggleTitleStyles}>
              {t(
                'input.videoSuggestion.includeWatchedChannelsLabel',
                'Include my watched channels'
              )}
            </div>
            <div className={contextToggleHintStyles}>
              {t(
                'input.videoSuggestion.includeWatchedChannelsHint',
                'Let AI use your recent channel history as soft context.'
              )}
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}

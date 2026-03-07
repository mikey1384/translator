import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import type { VideoSuggestionRecency } from '@shared-types/app';
import {
  countryControlStyles,
  countryHintStyles,
  countryLabelStyles,
  detailsBlockStyles,
  detailsBodyStyles,
  detailsSummaryStyles,
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
  creatorSelectOptions: Option[];
  disabled: boolean;
  loading: boolean;
  onCreatorChange: (value: string) => void;
  onRemoveSavedCreator: () => void;
  onCountryBlur: (value: string) => void;
  onCountryChange: (value: string) => void;
  onRecencyChange: (value: VideoSuggestionRecency) => void;
  onRemoveSavedSubtopic: () => void;
  onRemoveSavedTopic: () => void;
  onSubtopicChange: (value: string) => void;
  onTopicChange: (value: string) => void;
  canRemoveSavedCreator: boolean;
  canRemoveSavedSubtopic: boolean;
  canRemoveSavedTopic: boolean;
  recencyOptions: RecencyOption[];
  sanitizedCreator: string;
  sanitizedSubtopic: string;
  sanitizedTopic: string;
  subtopicSelectOptions: Option[];
  t: TFunction;
  targetCountry: string;
  targetRecency: VideoSuggestionRecency;
  topicSelectOptions: Option[];
};

export default function VideoSuggestionPreferencesForm({
  creatorSelectOptions,
  disabled,
  loading,
  onCreatorChange,
  onRemoveSavedCreator,
  onCountryBlur,
  onCountryChange,
  onRecencyChange,
  onRemoveSavedSubtopic,
  onRemoveSavedTopic,
  onSubtopicChange,
  onTopicChange,
  canRemoveSavedCreator,
  canRemoveSavedSubtopic,
  canRemoveSavedTopic,
  recencyOptions,
  sanitizedCreator,
  sanitizedSubtopic,
  sanitizedTopic,
  subtopicSelectOptions,
  t,
  targetCountry,
  targetRecency,
  topicSelectOptions,
}: VideoSuggestionPreferencesFormProps) {
  const showTopicPreference = topicSelectOptions.length > 0;
  const showCreatorPreference = creatorSelectOptions.length > 0;
  const showSubtopicPreference = subtopicSelectOptions.length > 0;
  const hasPreferenceDetails = Boolean(
    showTopicPreference || showCreatorPreference || showSubtopicPreference
  );
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!hasPreferenceDetails) {
      setDetailsOpen(false);
    }
  }, [hasPreferenceDetails]);

  return (
    <div className={countryControlStyles}>
      <div className={preferencesGridStyles}>
        <div className={preferenceFieldStyles}>
          <label
            htmlFor="video-suggestion-country"
            className={countryLabelStyles}
          >
            {t('input.videoSuggestion.countryLabel', 'Target country / region')}
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
              'input.videoSuggestion.countryHint',
              'Leave blank for global results.'
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

      {hasPreferenceDetails ? (
        <details
          className={detailsBlockStyles}
          open={detailsOpen}
          onToggle={event => {
            setDetailsOpen(event.currentTarget.open);
          }}
        >
          <summary className={detailsSummaryStyles}>
            {t(
              'input.videoSuggestion.preference.detailsToggle',
              'Preference details (optional)'
            )}
          </summary>
          <div className={detailsBodyStyles}>
            {showTopicPreference ? (
              <div className={preferenceFieldStyles}>
                <div className={preferenceLabelRowStyles}>
                  <label
                    htmlFor="video-suggestion-topic"
                    className={countryLabelStyles}
                  >
                    {t(
                      'input.videoSuggestion.preference.topicLabel',
                      'Preferred topic'
                    )}
                  </label>
                  {canRemoveSavedTopic ? (
                    <button
                      type="button"
                      className={preferenceRemoveButtonStyles}
                      onClick={() => onRemoveSavedTopic()}
                      disabled={disabled || loading}
                    >
                      {t(
                        'input.videoSuggestion.preference.removeSaved',
                        'Remove saved'
                      )}
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

            {showCreatorPreference ? (
              <div className={preferenceFieldStyles}>
                <div className={preferenceLabelRowStyles}>
                  <label
                    htmlFor="video-suggestion-creator"
                    className={countryLabelStyles}
                  >
                    {t(
                      'input.videoSuggestion.preference.creatorLabel',
                      'Preferred creator style'
                    )}
                  </label>
                  {canRemoveSavedCreator ? (
                    <button
                      type="button"
                      className={preferenceRemoveButtonStyles}
                      onClick={() => onRemoveSavedCreator()}
                      disabled={disabled || loading}
                    >
                      {t(
                        'input.videoSuggestion.preference.removeSaved',
                        'Remove saved'
                      )}
                    </button>
                  ) : null}
                </div>
                <select
                  id="video-suggestion-creator"
                  value={sanitizedCreator || ''}
                  onChange={event => onCreatorChange(event.target.value)}
                  className={inputStyles}
                  disabled={disabled || loading}
                >
                  {creatorSelectOptions.map(option => (
                    <option key={option.value || 'none'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {showSubtopicPreference ? (
              <div className={preferenceFieldStyles}>
                <div className={preferenceLabelRowStyles}>
                  <label
                    htmlFor="video-suggestion-subtopic"
                    className={countryLabelStyles}
                  >
                    {t(
                      'input.videoSuggestion.preference.subtopicLabel',
                      'Preferred subtopic / genre'
                    )}
                  </label>
                  {canRemoveSavedSubtopic ? (
                    <button
                      type="button"
                      className={preferenceRemoveButtonStyles}
                      onClick={() => onRemoveSavedSubtopic()}
                      disabled={disabled || loading}
                    >
                      {t(
                        'input.videoSuggestion.preference.removeSaved',
                        'Remove saved'
                      )}
                    </button>
                  ) : null}
                </div>
                <select
                  id="video-suggestion-subtopic"
                  value={sanitizedSubtopic || ''}
                  onChange={event => onSubtopicChange(event.target.value)}
                  className={inputStyles}
                  disabled={disabled || loading}
                >
                  {subtopicSelectOptions.map(option => (
                    <option key={option.value || 'none'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

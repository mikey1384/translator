import { useState, ChangeEvent } from 'react';
import { css } from '@emotion/css';
import {
  errorMessageStyles,
  selectStyles,
  fileInputWrapperStyles,
} from '../styles';
import Button from '../components/Button';
import ButtonGroup from '../components/ButtonGroup';
import Section from '../components/Section';
import { colors } from '../styles';

// Maximum file size in MB
const MAX_MB = 500;
const MAX_FILE_SIZE = MAX_MB * 1024 * 1024;

// Expanded and grouped languages
const languageGroups = [
  {
    label: 'East Asia',
    options: [
      { value: 'korean', label: 'Korean' },
      { value: 'japanese', label: 'Japanese' },
      { value: 'chinese_simplified', label: 'Chinese (Simplified)' },
      { value: 'chinese_traditional', label: 'Chinese (Traditional)' },
      { value: 'vietnamese', label: 'Vietnamese' },
    ],
  },
  {
    label: 'Europe',
    options: [
      { value: 'spanish', label: 'Spanish' },
      { value: 'french', label: 'French' },
      { value: 'german', label: 'German' },
      { value: 'italian', label: 'Italian' },
      { value: 'portuguese', label: 'Portuguese' },
      { value: 'russian', label: 'Russian' },
      { value: 'dutch', label: 'Dutch' },
      { value: 'polish', label: 'Polish' },
      { value: 'swedish', label: 'Swedish' },
      { value: 'turkish', label: 'Turkish' },
      { value: 'norwegian', label: 'Norwegian' },
      { value: 'danish', label: 'Danish' },
      { value: 'finnish', label: 'Finnish' },
      { value: 'greek', label: 'Greek' },
      { value: 'czech', label: 'Czech' },
      { value: 'hungarian', label: 'Hungarian' },
      { value: 'romanian', label: 'Romanian' },
      { value: 'ukrainian', label: 'Ukrainian' },
      // Add more European languages if needed
    ],
  },
  {
    label: 'South / Southeast Asia',
    options: [
      { value: 'hindi', label: 'Hindi' },
      { value: 'indonesian', label: 'Indonesian' },
      { value: 'thai', label: 'Thai' },
      { value: 'malay', label: 'Malay' },
      { value: 'tagalog', label: 'Tagalog (Filipino)' },
      { value: 'bengali', label: 'Bengali' },
      { value: 'tamil', label: 'Tamil' },
      { value: 'telugu', label: 'Telugu' },
      { value: 'marathi', label: 'Marathi' },
      { value: 'urdu', label: 'Urdu' },
      // Add more South/Southeast Asian languages if needed
    ],
  },
  {
    label: 'Middle East / Africa',
    options: [
      { value: 'arabic', label: 'Arabic' },
      { value: 'hebrew', label: 'Hebrew' },
      { value: 'farsi', label: 'Farsi (Persian)' },
      { value: 'swahili', label: 'Swahili' },
      { value: 'afrikaans', label: 'Afrikaans' },
      // Add more relevant languages here if needed
    ],
  },
  // Add more groups as needed
];

// Base options
const baseLanguageOptions = [
  { value: 'original', label: 'Same as Audio' },
  { value: 'english', label: 'English' },
];

// Define Key Status Type (can be shared or redefined if needed)
type ApiKeyStatus = {
  openai: boolean;
  anthropic: boolean;
} | null;

interface GenerateSubtitlesProps {
  videoFile: File | null;
  onSetVideoFile: (file: File | null) => void;
  onSubtitlesGenerated: (subtitles: string) => void;
  showOriginalText: boolean;
  onShowOriginalTextChange: (show: boolean) => void;
  apiKeyStatus: ApiKeyStatus;
  isLoadingKeyStatus: boolean;
  onNavigateToSettings: (show: boolean) => void;
}

// Add styles for the locked state - Dark Theme
const lockedContainerStyles = css`
  padding: 2rem 1.5rem;
  border: 1px solid ${colors.border}; // Use theme border color
  border-radius: 8px;
  background-color: ${colors.light}; // Use secondary dark background
  text-align: center;
  margin-bottom: 1rem;
`;

const lockedTitleStyles = css`
  font-size: 1.1rem;
  font-weight: 600;
  color: ${colors.dark}; // Use light text color
  margin-bottom: 0.75rem;
`;

const lockedProgressStyles = css`
  font-size: 1rem;
  color: ${colors.grayDark}; // Use secondary light text
  margin-bottom: 1.5rem;
  span {
    font-weight: bold;
    color: ${colors.primary}; // Use primary accent color
  }
`;

const goToSettingsButtonStyles = css`
  padding: 8px 16px;
  font-size: 0.9rem;
  background-color: ${colors.grayLight}; // Use surface color for background
  color: ${colors.dark}; // Use light text color
  border: 1px solid ${colors.border}; // Use theme border color
  border-radius: 6px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  box-shadow: none; // Flat design

  &:hover {
    background-color: ${colors.border}; // Slightly darker on hover
    border-color: ${colors.primary};
    color: ${colors.dark};
  }
`;

// Adjusted type for file change events from Button
type FileChangeEvent =
  | ChangeEvent<HTMLInputElement>
  | { target: { files: FileList | { name: string; path: string }[] | null } };

export default function GenerateSubtitles({
  videoFile,
  onSetVideoFile,
  onSubtitlesGenerated,
  showOriginalText,
  onShowOriginalTextChange,
  apiKeyStatus,
  isLoadingKeyStatus,
  onNavigateToSettings,
}: GenerateSubtitlesProps) {
  const [targetLanguage, setTargetLanguage] = useState<string>('original');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [subtitles, setSubtitles] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Calculate key status
  const keysSetCount = apiKeyStatus
    ? (apiKeyStatus.openai ? 1 : 0) + (apiKeyStatus.anthropic ? 1 : 0)
    : 0;
  const allKeysSet = keysSetCount === 2;

  return (
    <Section title="Generate Subtitles">
      {isLoadingKeyStatus && <p>Loading API Key status...</p>}

      {!isLoadingKeyStatus && !allKeysSet && (
        <div className={lockedContainerStyles}>
          <div className={lockedTitleStyles}>API Key Setup Required</div>
          <div className={lockedProgressStyles}>
            Required Keys Set: <span>{keysSetCount}</span>/2
          </div>
          <p
            style={{
              fontSize: '0.9rem',
              color: colors.gray,
              marginBottom: '1rem',
            }}
          >
            Please add your OpenAI and Anthropic API keys in the settings to
            enable subtitle generation and translation.
          </p>
          <button
            className={goToSettingsButtonStyles}
            onClick={() => onNavigateToSettings(true)}
            title="Go to Settings to add API Keys"
          >
            Go to Settings
          </button>
        </div>
      )}

      {!isLoadingKeyStatus && allKeysSet && (
        <>
          {error && <div className={errorMessageStyles}>{error}</div>}

          <div className={fileInputWrapperStyles}>
            <label style={{ marginRight: '8px' }}>
              1. Select Video File (up to {MAX_MB}MB):{' '}
            </label>
            <Button
              asFileInput
              accept="video/*"
              onFileChange={handleFileChange}
              variant="secondary"
              size="md"
            >
              {videoFile ? `Selected: ${videoFile.name}` : 'Choose Video'}
            </Button>
          </div>

          <div className={fileInputWrapperStyles}>
            <label>2. Output Language: </label>
            <select
              value={targetLanguage}
              onChange={e => setTargetLanguage(e.target.value)}
              className={selectStyles}
              disabled={isGenerating}
            >
              {/* Render base options first */}
              {baseLanguageOptions.map(lang => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
              {/* Render grouped options */}
              {languageGroups.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map(lang => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {targetLanguage !== 'original' && targetLanguage !== 'english' && (
              <div
                className={css`
                  margin-top: 12px;
                  display: flex;
                  align-items: center;
                `}
              >
                <label
                  className={css`
                    display: flex;
                    align-items: center;
                    cursor: pointer;
                    user-select: none;
                    margin: 0;
                    line-height: 1;
                  `}
                >
                  <input
                    type="checkbox"
                    checked={showOriginalText}
                    onChange={e => onShowOriginalTextChange(e.target.checked)}
                    className={css`
                      margin-right: 8px;
                      width: 16px;
                      height: 16px;
                      accent-color: #4361ee;
                      margin-top: 0;
                      margin-bottom: 0;
                      vertical-align: middle;
                    `}
                  />
                  <span
                    className={css`
                      display: inline-block;
                      vertical-align: middle;
                    `}
                  >
                    Show original text
                  </span>
                </label>
              </div>
            )}
          </div>

          <ButtonGroup>
            <Button
              onClick={handleGenerateSubtitles}
              disabled={!videoFile || isGenerating}
              size="md"
              variant="primary"
              isLoading={isGenerating}
            >
              {isGenerating ? 'Processing...' : 'Generate Subtitles'}
            </Button>

            {subtitles && (
              <Button
                variant="secondary"
                onClick={handleSaveSubtitles}
                size="md"
              >
                Save SRT
              </Button>
            )}
          </ButtonGroup>
        </>
      )}
    </Section>
  );

  // Updated file handler to work with Button's event type
  function handleFileChange(event: FileChangeEvent) {
    setError('');
    let file: File | null = null;

    if (
      'target' in event &&
      event.target &&
      'files' in event.target &&
      event.target.files
    ) {
      if (
        event.target.files instanceof FileList &&
        event.target.files.length > 0
      ) {
        file = event.target.files[0];
      } else if (
        Array.isArray(event.target.files) &&
        event.target.files.length > 0 &&
        'name' in event.target.files[0]
      ) {
        // Handle the simulated directory event (though not expected here)
        // For a single file input, we only care about FileList
        console.warn(
          'Received unexpected directory structure in file input handler'
        );
        file = null;
      }
    }

    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`File exceeds ${MAX_MB}MB limit`);
        onSetVideoFile(null);
        return;
      }
      onSetVideoFile(file);
    } else {
      // If event doesn't yield a file (e.g., cancelled selection), ensure state is null
      // Don't clear if there was already a valid file selected previously unless explicitly cleared
      // onSetVideoFile(null); // Might want to avoid clearing if user cancels
      console.log('No file selected or selection cancelled.');
    }
  }

  async function handleGenerateSubtitles() {
    if (!videoFile || !window.electron) {
      setError('Please select a video file first');
      return;
    }

    try {
      setError('');
      setIsGenerating(true);

      const result = await window.electron.generateSubtitles({
        videoFile: videoFile,
        targetLanguage,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      setSubtitles(result.subtitles);
      onSubtitlesGenerated(result.subtitles);
    } catch (err: any) {
      setError(`Error generating subtitles: ${err.message || err}`);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveSubtitles() {
    if (!subtitles || !window.electron) {
      setError('No subtitles to save');
      return;
    }

    try {
      const result = await window.electron.saveFile({
        content: subtitles,
        defaultPath: `subtitles_${Date.now()}.srt`,
        filters: [{ name: 'Subtitle File', extensions: ['srt'] }],
      });

      if (result.error) {
        throw new Error(result.error);
      }

      window.electron.showMessage(`Subtitles saved to: ${result.filePath}`);
    } catch (err: any) {
      setError(`Error saving subtitles: ${err.message || err}`);
    }
  }
}

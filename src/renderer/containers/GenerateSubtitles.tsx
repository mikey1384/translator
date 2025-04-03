import React, { useState } from 'react';
import { css } from '@emotion/css';
import {
  errorMessageStyles,
  selectStyles,
  fileInputWrapperStyles,
} from '../styles';
import Button from '../components/Button';
import ButtonGroup from '../components/ButtonGroup';
import StylizedFileInput from '../components/StylizedFileInput';
import Section from '../components/Section';

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

interface GenerateSubtitlesProps {
  videoFile: File | null;
  onSetVideoFile: (file: File | null) => void;
  onSubtitlesGenerated: (subtitles: string) => void;
  showOriginalText: boolean;
  onShowOriginalTextChange: (show: boolean) => void;
}

export default function GenerateSubtitles({
  videoFile,
  onSetVideoFile,
  onSubtitlesGenerated,
  showOriginalText,
  onShowOriginalTextChange,
}: GenerateSubtitlesProps) {
  const [targetLanguage, setTargetLanguage] = useState<string>('original');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [subtitles, setSubtitles] = useState<string>('');
  const [error, setError] = useState<string>('');

  return (
    <Section title="Generate Subtitles">
      {/* Error display */}
      {error && <div className={errorMessageStyles}>{error}</div>}

      <div className={fileInputWrapperStyles}>
        <label>1. Select Video File (up to {MAX_MB}MB): </label>
        <StylizedFileInput
          accept="video/*"
          onChange={handleFileChange}
          buttonText="Choose Video"
          showSelectedFile={isGenerating ? false : !!videoFile}
          key={videoFile ? videoFile.name + videoFile.lastModified : 'no-file'}
          currentFile={videoFile}
        />
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
          <Button variant="secondary" onClick={handleSaveSubtitles} size="md">
            Save SRT
          </Button>
        )}
      </ButtonGroup>
    </Section>
  );

  // --- Helper Functions ---

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
    const file = e.target.files?.[0];

    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`File exceeds ${MAX_MB}MB limit`);
        onSetVideoFile(null);
        return;
      }
      onSetVideoFile(file);
    } else {
      onSetVideoFile(null);
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

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

// Languages for translation
const languages = [
  { value: 'original', label: 'Same as Audio' },
  { value: 'english', label: 'Translate to English' },
  { value: 'korean', label: 'Translate to Korean' },
  { value: 'spanish', label: 'Translate to Spanish' },
  { value: 'french', label: 'Translate to French' },
  { value: 'german', label: 'Translate to German' },
  { value: 'chinese', label: 'Translate to Chinese' },
  { value: 'japanese', label: 'Translate to Japanese' },
  { value: 'russian', label: 'Translate to Russian' },
  { value: 'portuguese', label: 'Translate to Portuguese' },
  { value: 'italian', label: 'Translate to Italian' },
  { value: 'arabic', label: 'Translate to Arabic' },
];

interface GenerateSubtitlesProps {
  onSubtitlesGenerated: (subtitles: string, videoFile: File) => void;
}

export default function GenerateSubtitles({
  onSubtitlesGenerated,
}: GenerateSubtitlesProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<string>('original');
  const [showOriginalText, setShowOriginalText] = useState<boolean>(true);

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
          showSelectedFile={isGenerating ? false : !!selectedFile}
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
          {languages.map(lang => (
            <option key={lang.value} value={lang.value}>
              {lang.label}
            </option>
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
                onChange={e => setShowOriginalText(e.target.checked)}
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
          disabled={!selectedFile || isGenerating}
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
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];

      if (file.size > MAX_FILE_SIZE) {
        setError(`File exceeds ${MAX_MB}MB limit`);
        return;
      }

      setSelectedFile(file);
    }
  }

  async function handleGenerateSubtitles() {
    if (!selectedFile || !window.electron) {
      setError('Please select a video file first');
      return;
    }

    try {
      setError('');
      setIsGenerating(true);

      const result = await window.electron.generateSubtitles({
        videoFile: selectedFile,
        targetLanguage,
        showOriginalText,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      setSubtitles(result.subtitles);
      if (selectedFile) {
        onSubtitlesGenerated(result.subtitles, selectedFile);
      }
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

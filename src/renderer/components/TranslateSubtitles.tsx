import { useState } from 'react';
import { css } from '@emotion/css';
import {
  formGroupStyles,
  formLabelStyles,
  actionButtonsStyles,
  errorMessageStyles,
  resultsAreaStyles,
  resultsHeaderStyles,
  selectStyles,
} from '../styles';
import Button from './Button';
import Section from './Section';

const languages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ru', name: 'Russian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
];

interface TranslateSubtitlesProps {
  subtitles: string;
  sourceLanguage: string;
  onTranslated: (translatedSubtitles: string) => void;
}

export default function TranslateSubtitles({
  subtitles,
  sourceLanguage,
  onTranslated,
}: TranslateSubtitlesProps) {
  const [targetLanguage, setTargetLanguage] = useState<string>('en');

  const [translatedSubtitles, setTranslatedSubtitles] = useState<string>('');
  const [error, setError] = useState<string>('');

  const COMPLETION_DISPLAY_DURATION_MS = 2000;

  return (
    <Section title="Translate Subtitles">
      {error && <div className={errorMessageStyles}>{error}</div>}

      <div className={formGroupStyles}>
        <div className={formLabelStyles}>Source Language:</div>
        <div
          className={css`
            font-size: 0.95rem;
            margin-bottom: 1rem;
          `}
        >
          {languages.find(l => l.code === sourceLanguage)?.name ||
            sourceLanguage}
        </div>

        <label className={formLabelStyles}>Target Language:</label>
        <select
          className={selectStyles}
          value={targetLanguage}
          onChange={e => setTargetLanguage(e.target.value)}
        >
          {languages.map(lang => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>

      <div className={actionButtonsStyles}>
        <Button
          disabled={!subtitles || sourceLanguage === targetLanguage}
          onClick={handleTranslateSubtitles}
        >
          Translate Subtitles
        </Button>
      </div>

      {translatedSubtitles && (
        <div
          className={css`
            margin-top: 2rem;
          `}
        >
          <h3 className={resultsHeaderStyles}>Translated Subtitles:</h3>

          <div className={resultsAreaStyles}>{translatedSubtitles}</div>

          <div className={actionButtonsStyles}>
            <Button variant="secondary" onClick={handleSaveSubtitles}>
              Save SRT
            </Button>
          </div>
        </div>
      )}
    </Section>
  );

  async function handleTranslateSubtitles() {
    if (!subtitles || !window.electron) {
      setError('No subtitles to translate');
      return;
    }

    if (sourceLanguage === targetLanguage) {
      setError('Source and target languages must be different');
      return;
    }

    try {
      setError('');

      const result = await window.electron.translateSubtitles({
        subtitles,
        sourceLanguage,
        targetLanguage,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      setTranslatedSubtitles(result.translatedSubtitles);

      setTimeout(() => {
        onTranslated(result.translatedSubtitles);
      }, COMPLETION_DISPLAY_DURATION_MS);
    } catch (err: any) {
      setError(`Error translating subtitles: ${err.message || err}`);
    }
  }

  async function handleSaveSubtitles() {
    if (!translatedSubtitles || !window.electron) {
      setError('No translated subtitles to save');
      return;
    }

    try {
      const result = await window.electron.saveFile({
        content: translatedSubtitles,
        defaultPath: `translated_subtitles_${Date.now()}.srt`,
        filters: [{ name: 'Subtitle File', extensions: ['srt'] }],
      });

      if (result.error) {
        throw new Error(result.error);
      }

      window.electron.showMessage(
        `Translated subtitles saved to: ${result.filePath}`
      );
    } catch (err: any) {
      setError(`Error saving translated subtitles: ${err.message || err}`);
    }
  }
}

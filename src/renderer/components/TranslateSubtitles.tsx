import { useState, useEffect } from 'react';
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
import TranslationProgressArea from '../containers/TranslationProgressArea';
import { registerSubtitleStreamListeners } from '../helpers/electron-ipc';

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

  const [isTranslationInProgress, setIsTranslationInProgress] =
    useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<string>('');
  const [translationProgress, setTranslationProgress] = useState<number>(0);
  const [translationStage, setTranslationStage] = useState<string>('');
  const [subtitleProgress, setSubtitleProgress] = useState<{
    current?: number;
    total?: number;
  }>({});

  const [translatedSubtitles, setTranslatedSubtitles] = useState<string>('');
  const [error, setError] = useState<string>('');

  const COMPLETION_DISPLAY_DURATION_MS = 2000;

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (isTranslationInProgress) {
      cleanup = registerSubtitleStreamListeners(data => {
        if (
          data.stage.toLowerCase().includes('audio') ||
          data.stage.toLowerCase().includes('prepare')
        ) {
          setProgress(data.percent);
          setProgressStage(data.stage);
        } else {
          setTranslationProgress(data.percent);
          setTranslationStage(data.stage);

          if (data.current && data.total) {
            setSubtitleProgress({
              current: data.current,
              total: data.total,
            });
          }
        }
      }, 'translate');
    }

    return () => {
      if (cleanup) cleanup();
    };
  }, [isTranslationInProgress]);

  return (
    <Section title="Translate Subtitles">
      {isTranslationInProgress && (
        <TranslationProgressArea
          progress={progress}
          progressStage={progressStage}
          translationProgress={translationProgress}
          translationStage={translationStage}
          subtitleProgress={subtitleProgress}
          onClose={() => setIsTranslationInProgress(false)}
        />
      )}

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
          disabled={isTranslationInProgress}
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
          disabled={
            !subtitles ||
            isTranslationInProgress ||
            sourceLanguage === targetLanguage
          }
          onClick={handleTranslateSubtitles}
          isLoading={isTranslationInProgress}
        >
          {isTranslationInProgress ? 'Translating...' : 'Translate Subtitles'}
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
      setIsTranslationInProgress(true);
      setProgress(0);
      setProgressStage('Starting translation...');
      setTranslationProgress(0);
      setTranslationStage('Preparing translation model...');
      setSubtitleProgress({});

      const result = await window.electron.translateSubtitles({
        subtitles,
        sourceLanguage,
        targetLanguage,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      setTranslatedSubtitles(result.translatedSubtitles);
      setTranslationProgress(100);
      setTranslationStage('Translation complete!');

      setTimeout(() => {
        onTranslated(result.translatedSubtitles);
      }, COMPLETION_DISPLAY_DURATION_MS);
    } catch (err: any) {
      setError(`Error translating subtitles: ${err.message || err}`);
    } finally {
      setIsTranslationInProgress(false);
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

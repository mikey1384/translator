import React, { useState } from "react";
import { css } from "@emotion/css";
import {
  formGroupStyles,
  formLabelStyles,
  actionButtonsStyles,
  errorMessageStyles,
  resultsAreaStyles,
  resultsHeaderStyles,
  selectStyles,
} from "../styles";
import Button from "./Button";
import Section from "./Section";
import TranslationProgressArea from "./TranslationProgressArea";

// Languages for translation
const languages = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "ru", name: "Russian" },
  { code: "pt", name: "Portuguese" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
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
  const [targetLanguage, setTargetLanguage] = useState<string>("en");

  // Progress tracking
  const [isTranslationInProgress, setIsTranslationInProgress] =
    useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<string>("");
  const [translationProgress, setTranslationProgress] = useState<number>(0);
  const [translationStage, setTranslationStage] = useState<string>("");
  const [subtitleProgress, setSubtitleProgress] = useState<{
    current?: number;
    total?: number;
    warning?: string;
  }>({});

  // Results
  const [translatedSubtitles, setTranslatedSubtitles] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Translate subtitles
  const handleTranslateSubtitles = async () => {
    if (!subtitles || !window.electron) {
      setError("No subtitles to translate");
      return;
    }

    if (sourceLanguage === targetLanguage) {
      setError("Source and target languages must be different");
      return;
    }

    try {
      setError("");
      setIsTranslationInProgress(true);
      setProgress(0);
      setProgressStage("Starting translation...");
      setTranslationProgress(0);
      setTranslationStage("Preparing translation model...");
      setSubtitleProgress({});

      // Set up progress listener
      if (typeof window.electron.onTranslateSubtitlesProgress === "function") {
        window.electron.onTranslateSubtitlesProgress((data) => {
          // Update the proper progress metrics based on the stage
          if (
            data.stage.toLowerCase().includes("audio") ||
            data.stage.toLowerCase().includes("prepare")
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
                warning: data.warning || undefined,
              });
            }
          }
        });
      }

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
      setTranslationStage("Translation complete!");

      // Auto close will handle this after a delay
      setTimeout(() => {
        onTranslated(result.translatedSubtitles);
      }, 2000);
    } catch (err: any) {
      setError(`Error translating subtitles: ${err.message || err}`);
      setIsTranslationInProgress(false);
    }
  };

  // Save translated subtitles
  const handleSaveSubtitles = async () => {
    if (!translatedSubtitles || !window.electron) {
      setError("No translated subtitles to save");
      return;
    }

    try {
      const result = await window.electron.saveFile({
        content: translatedSubtitles,
        defaultPath: `translated_subtitles_${Date.now()}.srt`,
        filters: [{ name: "Subtitle File", extensions: ["srt"] }],
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
  };

  return (
    <Section title="Translate Subtitles">
      {/* Progress overlay */}
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

      {/* Error display */}
      {error && <div className={errorMessageStyles}>{error}</div>}

      <div className={formGroupStyles}>
        <div className={formLabelStyles}>Source Language:</div>
        <div
          className={css`
            font-size: 0.95rem;
            margin-bottom: 1rem;
          `}
        >
          {languages.find((l) => l.code === sourceLanguage)?.name ||
            sourceLanguage}
        </div>

        <label className={formLabelStyles}>Target Language:</label>
        <select
          className={selectStyles}
          value={targetLanguage}
          onChange={(e) => setTargetLanguage(e.target.value)}
          disabled={isTranslationInProgress}
        >
          {languages.map((lang) => (
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
          {isTranslationInProgress ? "Translating..." : "Translate Subtitles"}
        </Button>
      </div>

      {/* Translation Result */}
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
}

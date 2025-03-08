import React, { useState } from "react";
import { css } from "@emotion/css";
import {
  formGroupStyles,
  formLabelStyles,
  formRowStyles,
  actionButtonsStyles,
  errorMessageStyles,
  resultsAreaStyles,
  resultsHeaderStyles,
  selectStyles,
} from "../styles";
import Button from "./Button";
import StylizedFileInput from "./StylizedFileInput";
import ProgressBar from "./ProgressBar";
import Section from "./Section";

// Languages for subtitle generation
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

interface GenerateSubtitlesProps {
  onSubtitlesGenerated: (subtitles: string) => void;
}

export default function GenerateSubtitles({
  onSubtitlesGenerated,
}: GenerateSubtitlesProps) {
  // File selection state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoPath, setVideoPath] = useState<string>("");
  const [sourceLanguage, setSourceLanguage] = useState<string>("en");

  // Progress tracking
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<string>("");

  // Results
  const [subtitles, setSubtitles] = useState<string>("");
  const [error, setError] = useState<string>("");

  // File selection from input element
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError("");
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      console.log("File selected:", file.name, file.size);
      setSelectedFile(file);
      setVideoPath(""); // Clear path if we have a file object
    }
  };

  // File selection from system
  const handleFileBrowse = () => {
    if (!window.electron) {
      setError("Electron API not available");
      return;
    }

    window.electron
      .openFile({
        filters: [
          { name: "Video Files", extensions: ["mp4", "avi", "mkv", "mov"] },
        ],
        multiple: false,
      })
      .then((result) => {
        if (result.filePaths && result.filePaths.length > 0) {
          setVideoPath(result.filePaths[0]);
          setSelectedFile(null); // Clear the file input if we have a path
        }
      })
      .catch((error) => {
        setError(`Error selecting file: ${error.message || error}`);
      });
  };

  // Generate subtitles
  const handleGenerateSubtitles = async () => {
    if ((!selectedFile && !videoPath) || !window.electron) {
      setError("Please select a video file first");
      return;
    }

    try {
      setError("");
      setIsGenerating(true);
      setProgress(0);
      setProgressStage("Starting subtitle generation...");

      // Set up progress listener
      if (typeof window.electron.onGenerateSubtitlesProgress === "function") {
        window.electron.onGenerateSubtitlesProgress((data) => {
          setProgress(data.percent);
          setProgressStage(data.stage);
        });
      }

      // Log what we're sending to main process
      console.log("Sending to main process:", {
        videoPath: videoPath || undefined,
        videoFile: selectedFile || {},
        language: sourceLanguage,
      });

      const result = await window.electron.generateSubtitles({
        videoPath: videoPath || undefined,
        videoFile: selectedFile || {},
        language: sourceLanguage,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      setSubtitles(result.subtitles);
      setProgress(100);
      setProgressStage("Subtitles generation complete!");
      onSubtitlesGenerated(result.subtitles);
    } catch (err: any) {
      setError(`Error generating subtitles: ${err.message || err}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Save subtitles
  const handleSaveSubtitles = async () => {
    if (!subtitles || !window.electron) {
      setError("No subtitles to save");
      return;
    }

    try {
      const result = await window.electron.saveFile({
        content: subtitles,
        defaultPath: `subtitles_${Date.now()}.srt`,
        filters: [{ name: "Subtitle File", extensions: ["srt"] }],
      });

      if (result.error) {
        throw new Error(result.error);
      }

      window.electron.showMessage(`Subtitles saved to: ${result.filePath}`);
    } catch (err: any) {
      setError(`Error saving subtitles: ${err.message || err}`);
    }
  };

  return (
    <Section title="Generate Subtitles">
      {/* Progress indicator */}
      {isGenerating && (
        <div
          className={css`
            margin-bottom: 1rem;
          `}
        >
          <ProgressBar
            progress={progress}
            stage={progressStage}
            showPercentage={true}
          />
        </div>
      )}

      {/* Error display */}
      {error && <div className={errorMessageStyles}>{error}</div>}

      <div className={formGroupStyles}>
        <div className={formLabelStyles}>1. Select Video File:</div>

        <div className={formRowStyles}>
          <StylizedFileInput
            accept="video/*"
            onChange={handleFileChange}
            buttonText="Choose File"
          />

          <Button
            variant="secondary"
            onClick={handleFileBrowse}
            disabled={isGenerating}
          >
            Browse System...
          </Button>
        </div>

        {(videoPath || selectedFile) && (
          <div
            className={css`
              margin-top: 0.5rem;
              font-size: 0.9rem;
            `}
          >
            Selected: {videoPath || (selectedFile ? selectedFile.name : "")}
          </div>
        )}
      </div>

      <div className={formGroupStyles}>
        <label className={formLabelStyles}>
          2. Select Language in the Video:
        </label>
        <select
          className={selectStyles}
          value={sourceLanguage}
          onChange={(e) => setSourceLanguage(e.target.value)}
          disabled={isGenerating}
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
          disabled={(!selectedFile && !videoPath) || isGenerating}
          onClick={handleGenerateSubtitles}
          isLoading={isGenerating}
        >
          {isGenerating ? "Generating..." : "Generate Subtitles"}
        </Button>
      </div>

      {/* Subtitles Result */}
      {subtitles && (
        <div
          className={css`
            margin-top: 2rem;
          `}
        >
          <h3 className={resultsHeaderStyles}>Generated Subtitles:</h3>

          <div className={resultsAreaStyles}>{subtitles}</div>

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

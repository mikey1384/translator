import React, { useState } from "react";
import { css } from "@emotion/css";
import {
  formGroupStyles,
  formLabelStyles,
  formRowStyles,
  actionButtonsStyles,
  errorMessageStyles,
} from "../styles";
import Button from "./Button";
import ProgressBar from "./ProgressBar";
import Section from "./Section";
import StylizedFileInput from "./StylizedFileInput";

interface MergeSubtitlesProps {
  originalSubtitles: string;
  translatedSubtitles: string;
}

export default function MergeSubtitles({
  originalSubtitles,
  translatedSubtitles,
}: MergeSubtitlesProps) {
  // File selection
  const [videoFile, setVideoFile] = useState<File | null>(null);

  // Progress tracking
  const [isMerging, setIsMerging] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<string>("");

  // Results
  const [outputVideoPath, setOutputVideoPath] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Handle video file selection
  const handleVideoFileChange = (file: File | null) => {
    setVideoFile(file);
    setError("");
  };

  // Merge subtitles with video
  const handleMergeSubtitles = async () => {
    if (!videoFile || !translatedSubtitles || !window.electron) {
      setError("Video file and translated subtitles are required");
      return;
    }

    try {
      setError("");
      setIsMerging(true);
      setProgress(0);
      setProgressStage("Starting merge process...");

      // Set up progress listener
      if (typeof window.electron.onMergeSubtitlesProgress === "function") {
        window.electron.onMergeSubtitlesProgress((data) => {
          setProgress(data.percent);
          setProgressStage(data.stage);
        });
      }

      // Create a URL from the video file
      const videoPath = URL.createObjectURL(videoFile);

      // First save the subtitles to a temporary file
      const saveResult = await window.electron.saveFile({
        content: translatedSubtitles,
        defaultPath: `temp_subtitles_${Date.now()}.srt`,
        filters: [{ name: "SRT File", extensions: ["srt"] }],
      });

      if (saveResult.error) {
        throw new Error(saveResult.error);
      }

      // Then merge with the video
      const mergeResult = await window.electron.mergeSubtitles({
        videoPath: videoPath,
        subtitlesPath: saveResult.filePath,
      });

      if (mergeResult.error) {
        throw new Error(mergeResult.error);
      }

      setOutputVideoPath(mergeResult.outputPath);
      setProgress(100);
      setProgressStage("Merge complete!");
      window.electron.showMessage(
        `Video with subtitles saved to: ${mergeResult.outputPath}`
      );
    } catch (err: any) {
      setError(`Error merging subtitles: ${err.message || err}`);
    } finally {
      setIsMerging(false);
      // Clean up object URL if created
      if (videoFile) {
        URL.revokeObjectURL(URL.createObjectURL(videoFile));
      }
    }
  };

  return (
    <Section title="Merge Subtitles with Video">
      {/* Progress indicator */}
      {isMerging && (
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
        <div className={formLabelStyles}>Video File:</div>
        <StylizedFileInput
          accept="video/*"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              handleVideoFileChange(files[0]);
            } else {
              handleVideoFileChange(null);
            }
          }}
          disabled={isMerging}
          label="Choose Video File"
        />

        <div
          className={css`
            margin-top: 1.5rem;
          `}
        >
          <div className={formLabelStyles}>Subtitles:</div>
          <div
            className={css`
              font-size: 0.95rem;
              margin-bottom: 0.5rem;
            `}
          >
            {originalSubtitles && translatedSubtitles
              ? "Original and translated subtitles will be embedded in the video."
              : translatedSubtitles
              ? "Translated subtitles will be embedded in the video."
              : "No subtitles available for embedding."}
          </div>
        </div>
      </div>

      <div className={actionButtonsStyles}>
        <Button
          disabled={!videoFile || !translatedSubtitles || isMerging}
          onClick={handleMergeSubtitles}
          isLoading={isMerging}
        >
          {isMerging ? "Merging..." : "Merge with Video"}
        </Button>
      </div>

      {/* Result */}
      {outputVideoPath && (
        <div
          className={css`
            margin-top: 2rem;
          `}
        >
          <div className={formLabelStyles}>Output Video:</div>
          <div
            className={css`
              font-size: 0.95rem;
              margin-bottom: 1rem;
              word-break: break-all;
            `}
          >
            {outputVideoPath}
          </div>

          <div className={actionButtonsStyles}>
            <Button
              variant="secondary"
              onClick={() => {
                if (window.electron) {
                  window.electron.showMessage(
                    `Video saved at: ${outputVideoPath}`
                  );
                }
              }}
            >
              Show in Finder
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

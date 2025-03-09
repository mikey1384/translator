import React, { useEffect, useState } from "react";
import { css } from "@emotion/css";

// Components
import StatusSection from "./components/StatusSection";
import GenerateSubtitles from "./components/GenerateSubtitles";
import TranslateSubtitles from "./components/TranslateSubtitles";
import MergeSubtitles from "./components/MergeSubtitles";
import EditSubtitles from "./components/EditSubtitles";

// Define the window interface to access our Electron API
declare global {
  interface Window {
    electron: {
      // Test methods
      ping: () => Promise<string>;
      showMessage: (message: string) => Promise<boolean>;
      test: () => string;

      // Main app methods
      generateSubtitles: (options: any) => Promise<any>;
      onGenerateSubtitlesProgress: (callback: (progress: any) => void) => void;
      translateSubtitles: (options: any) => Promise<any>;
      onTranslateSubtitlesProgress: (callback: (progress: any) => void) => void;
      mergeSubtitles: (options: any) => Promise<any>;
      onMergeSubtitlesProgress: (callback: (progress: any) => void) => void;
      saveFile: (options: any) => Promise<any>;
      openFile: (options: any) => Promise<any>;
    };
  }
}

// Shared types
export interface SrtSegment {
  index: number;
  start: number; // in seconds
  end: number; // in seconds
  text: string;
}

// App component styles
const appWrapperStyles = css`
  min-height: 100vh;
  background-color: #f1f3f5;
  padding: 1rem 0;
`;

const appContainerStyles = css`
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  padding: 2rem;
`;

const appTitleStyles = css`
  font-size: 2.5rem;
  color: #212529;
  margin-bottom: 1.5rem;
  font-weight: 700;
`;

// Modern design system constants
const colors = {
  primary: "#4361ee",
  primaryLight: "#4895ef",
  primaryDark: "#3a0ca3",
  secondary: "#3f37c9",
  success: "#4cc9f0",
  info: "#4895ef",
  warning: "#f72585",
  danger: "#e63946",
  light: "#f8f9fa",
  dark: "#212529",
  gray: "#6c757d",
  grayLight: "#f1f3f5",
  grayDark: "#343a40",
  white: "#ffffff",
};

// Languages for subtitle generation and translation
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

// ===== Styles =====

// Container styles
const containerStyles = css`
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  padding: 2rem;
`;

// Main title styles
const titleStyles = css`
  font-size: 2.5rem;
  color: ${colors.dark};
  margin-bottom: 1.5rem;
  font-weight: 700;
`;

// Section styles
const sectionStyles = css`
  background-color: ${colors.white};
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  padding: 1.5rem;
  margin-bottom: 2rem;
`;

// Section title styles
const sectionTitleStyles = css`
  font-size: 1.25rem;
  font-weight: 600;
  color: ${colors.dark};
  margin-bottom: 1rem;
  display: flex;
  align-items: center;

  &::before {
    content: "";
    display: inline-block;
    width: 4px;
    height: 18px;
    background: linear-gradient(
      135deg,
      ${colors.primary} 0%,
      ${colors.primaryDark} 100%
    );
    margin-right: 10px;
    border-radius: 2px;
  }
`;

// Form input styles
const inputStyles = css`
  padding: 10px 14px;
  border-radius: 6px;
  border: 1px solid #e9ecef;
  font-size: 0.95rem;
  transition: all 0.2s ease;
  width: 100%;
  max-width: 320px;
  background-color: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);

  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.15);
  }
`;

// Select styles
const selectStyles = css`
  ${inputStyles}
  height: 42px;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236c757d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='6 9 12 15 18 9'%3E%3C/polygon%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 35px;
  appearance: none;
`;

// Button styles
const buttonStyles = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 18px;
  border-radius: 6px;
  font-weight: 500;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  background: linear-gradient(
    135deg,
    ${colors.primary} 0%,
    ${colors.primaryDark} 100%
  );
  color: white;
  border: none;
  box-shadow: 0 4px 10px rgba(67, 97, 238, 0.3);

  &:hover:not(:disabled) {
    box-shadow: 0 6px 15px rgba(67, 97, 238, 0.4);
    transform: translateY(-2px);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: 0 2px 5px rgba(67, 97, 238, 0.2);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    box-shadow: none;
  }
`;

const secondaryButtonStyles = css`
  ${buttonStyles}
  background: ${colors.white};
  color: ${colors.dark};
  border: 1px solid #e9ecef;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);

  &:hover:not(:disabled) {
    border-color: #dee2e6;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  }
`;

// Status indicator styles
const statusIndicatorStyles = (status: boolean) => css`
  display: inline-flex;
  align-items: center;

  &::before {
    content: "";
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: ${status ? colors.success : colors.danger};
    margin-right: 8px;
    box-shadow: 0 0 0 2px
      ${status ? "rgba(76, 201, 240, 0.3)" : "rgba(230, 57, 70, 0.3)"};
  }
`;

// Progress indicator styles
const progressBarStyles = css`
  width: 100%;
  height: 8px;
  background-color: ${colors.grayLight};
  border-radius: 4px;
  overflow: hidden;
  margin: 1rem 0;
`;

const progressBarFillStyles = (progress: number) => css`
  height: 100%;
  width: ${progress}%;
  background: linear-gradient(
    90deg,
    ${colors.primaryLight} 0%,
    ${colors.primary} 100%
  );
  border-radius: 4px;
  transition: width 0.3s ease;
`;

const progressStageStyles = css`
  font-size: 0.875rem;
  color: ${colors.gray};
  margin-bottom: 0.5rem;
`;

// Results styles
const resultsAreaStyles = css`
  margin-top: 1rem;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 1rem;
  background-color: ${colors.grayLight};
  max-height: 300px;
  overflow-y: auto;
  font-family: monospace;
  white-space: pre-wrap;
  font-size: 0.875rem;
`;

export default function App() {
  // States for electron connection
  const [electronConnected, setElectronConnected] = useState<boolean>(false);

  // Media states
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");

  // Subtitle states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [generatedSubtitles, setGeneratedSubtitles] = useState<string>("");
  const [translatedSubtitles, setTranslatedSubtitles] = useState<string>("");

  // Parsed subtitle states (for editing)
  const [subtitleSegments, setSubtitleSegments] = useState<SrtSegment[]>([]);
  const [translatedSegments, setTranslatedSegments] = useState<SrtSegment[]>(
    []
  );

  // Language settings
  const [sourceLanguage, setSourceLanguage] = useState<string>("en");
  const [targetLanguage, setTargetLanguage] = useState<string>("es");
  const [showOriginalText, setShowOriginalText] = useState<boolean>(true);

  // Progress tracking
  const [isTranslationInProgress, setIsTranslationInProgress] =
    useState<boolean>(false);
  const [isMergingInProgress, setIsMergingInProgress] =
    useState<boolean>(false);

  // Check if electron is connected
  useEffect(() => {
    const checkElectron = async () => {
      try {
        if (window.electron) {
          const response = await window.electron.ping();
          setElectronConnected(response === "pong");
        }
      } catch (err) {
        console.error("Error checking Electron connection:", err);
        setElectronConnected(false);
      }
    };

    checkElectron();
  }, []);

  // Handle generated subtitles
  const handleSubtitlesGenerated = (generatedSubtitles: string) => {
    setGeneratedSubtitles(generatedSubtitles);

    // Parse the generated subtitles into segments for possible editing later
    try {
      const segments = parseSrt(generatedSubtitles);
      setSubtitleSegments(segments);
      setSourceLanguage(segments.length > 0 ? "en" : ""); // Assuming English by default
    } catch (err) {
      console.error("Error parsing generated subtitles:", err);
    }
  };

  // Handle translated subtitles
  const handleSubtitlesTranslated = (translated: string) => {
    setTranslatedSubtitles(translated);

    // Parse the translated subtitles into segments for possible editing later
    try {
      const segments = parseSrt(translated);
      setTranslatedSegments(segments);
    } catch (err) {
      console.error("Error parsing translated subtitles:", err);
    }
  };

  // Simple SRT parser function (this would be expanded in a real implementation)
  const parseSrt = (srtString: string): SrtSegment[] => {
    if (!srtString) return [];

    const segments: SrtSegment[] = [];
    const blocks = srtString.trim().split(/\r?\n\r?\n/);

    blocks.forEach((block) => {
      const lines = block.split(/\r?\n/);
      if (lines.length < 3) return;

      const index = parseInt(lines[0].trim(), 10);
      const timeMatch = lines[1].match(
        /(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)/
      );

      if (!timeMatch) return;

      const startTime = srtTimeToSeconds(timeMatch[1]);
      const endTime = srtTimeToSeconds(timeMatch[2]);

      // Get all text lines and join them
      const text = lines.slice(2).join("\n");

      segments.push({
        index,
        start: startTime,
        end: endTime,
        text,
      });
    });

    return segments;
  };

  // Convert SRT time format to seconds
  const srtTimeToSeconds = (timeString: string): number => {
    const parts = timeString.split(",");
    const timeParts = parts[0].split(":");

    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);
    const seconds = parseInt(timeParts[2], 10);
    const milliseconds = parseInt(parts[1], 10);

    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  };

  // Convert seconds to SRT time format
  const secondsToSrtTime = (totalSeconds: number): string => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds - hours * 3600) / 60);
    const seconds = Math.floor(totalSeconds - hours * 3600 - minutes * 60);
    const milliseconds = Math.round(
      (totalSeconds - Math.floor(totalSeconds)) * 1000
    );

    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")},${milliseconds
      .toString()
      .padStart(3, "0")}`;
  };

  return (
    <div className={appWrapperStyles}>
      <div className={appContainerStyles}>
        <h1 className={appTitleStyles}>Subtitle Generator & Translator</h1>

        <StatusSection isConnected={electronConnected} />

        <GenerateSubtitles onSubtitlesGenerated={handleSubtitlesGenerated} />

        {generatedSubtitles && (
          <TranslateSubtitles
            subtitles={generatedSubtitles}
            sourceLanguage={sourceLanguage}
            onTranslated={handleSubtitlesTranslated}
          />
        )}

        {(generatedSubtitles || translatedSubtitles) && (
          <MergeSubtitles
            originalSubtitles={generatedSubtitles}
            translatedSubtitles={translatedSubtitles}
          />
        )}

        {/* Add the Subtitle Editor component */}
        <EditSubtitles
          videoFile={videoFile}
          videoUrl={videoUrl}
          targetLanguage={targetLanguage}
          showOriginalText={showOriginalText}
          onSetVideoFile={setVideoFile}
          onSetVideoUrl={setVideoUrl}
          onSetError={(error) => console.error(error)}
          mergeSubtitlesWithVideo={async (videoFile, subtitles, options) => {
            setIsMergingInProgress(true);
            
            try {
              // Generate SRT content from subtitles
              const srtContent = subtitles.map((segment, i) => {
                const index = i + 1;
                const startTime = secondsToSrtTime(segment.start);
                const endTime = secondsToSrtTime(segment.end);
                return `${index}\n${startTime} --> ${endTime}\n${segment.text}`;
              }).join('\n\n');
              
              // Create a temporary file for the subtitles
              const subtitlesResult = await window.electron.saveFile({
                content: srtContent,
                defaultPath: 'subtitles.srt',
                filters: [{ name: 'Subtitle Files', extensions: ['srt'] }]
              });
              
              if (subtitlesResult.error) {
                throw new Error(subtitlesResult.error);
              }
              
              // Set up progress tracking
              window.electron.onMergeSubtitlesProgress((progress) => {
                options.onProgress(progress.percent);
              });
              
              // Get the path from the videoFile
              const videoPath = videoFile.path || videoFile.name;
              
              // Merge the video with the subtitles
              const result = await window.electron.mergeSubtitles({
                videoPath: videoPath,
                subtitlesPath: subtitlesResult.filePath
              });
              
              setIsMergingInProgress(false);
              
              if (result.error) {
                throw new Error(result.error);
              }
              
              return result;
            } catch (error) {
              setIsMergingInProgress(false);
              throw error;
            }
          }}
        />
      </div>
    </div>
  );
}

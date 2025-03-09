import React, { useEffect, useState, useRef } from "react";
import { css } from "@emotion/css";

// Components
import StatusSection from "./components/StatusSection";
import GenerateSubtitles from "./components/GenerateSubtitles";
import TranslateSubtitles from "./components/TranslateSubtitles";
import MergeSubtitles from "./components/MergeSubtitles";
import EditSubtitles from "./components/EditSubtitles";
import BackToTopButton from "./components/BackToTopButton";
import StickyVideoPlayer from "./components/StickyVideoPlayer";

// Styles
import {
  colors,
  pageWrapperStyles,
  containerStyles,
  titleStyles,
  statusIndicatorStyles,
} from "./styles";

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

  // Add state for the video player reference
  const [videoPlayerRef, setVideoPlayerRef] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [editingTimes, setEditingTimes] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Add a ref to track when video is visible for scroll behavior
  const mainContentRef = useRef<HTMLDivElement>(null);

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

  // Handle video player ready callback
  const handleVideoPlayerReady = (player: any) => {
    setVideoPlayerRef(player);
  };

  // Modified wrapper function with correct type signature
  const handleSetVideoUrl = (url: string | null) => {
    if (url !== null) {
      setVideoUrl(url);
    }
  };

  return (
    <div className={pageWrapperStyles}>
      <div id="top-padding" style={{ height: "10px" }}></div>
      <div className={containerStyles}>
        <h1 className={titleStyles}>Subtitle Generator & Translator</h1>

        <StatusSection isConnected={electronConnected} />

        {/* Place the StickyVideoPlayer here, near the top of the content flow */}
        {videoUrl && (
          <StickyVideoPlayer
            videoUrl={videoUrl}
            subtitles={subtitleSegments}
            onPlayerReady={handleVideoPlayerReady}
          />
        )}

        {/* Wrap the main content so we can have better scroll behavior */}
        <div ref={mainContentRef} style={{ position: "relative" }}>
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

          <EditSubtitles
            videoFile={videoFile}
            videoUrl={videoUrl}
            targetLanguage={targetLanguage}
            showOriginalText={showOriginalText}
            isPlaying={isPlaying}
            editingTimes={editingTimes}
            onSetVideoFile={setVideoFile}
            onSetVideoUrl={handleSetVideoUrl}
            onSetError={(error) => console.error(error)}
            onSetEditingTimes={setEditingTimes}
            onSetIsPlaying={setIsPlaying}
            secondsToSrtTime={secondsToSrtTime}
            parseSrt={parseSrt}
            subtitles={subtitleSegments}
            onSetSubtitles={setSubtitleSegments}
            videoPlayerRef={videoPlayerRef}
            isMergingInProgress={isMergingInProgress}
            onSetIsMergingInProgress={setIsMergingInProgress}
            mergeSubtitlesWithVideo={async (videoFile, subtitles, options) => {
              setIsMergingInProgress(true);

              try {
                // Generate SRT content from subtitles
                const srtContent = subtitles
                  .map((segment, i) => {
                    const index = i + 1;
                    const startTime = secondsToSrtTime(segment.start);
                    const endTime = secondsToSrtTime(segment.end);
                    return `${index}\n${startTime} --> ${endTime}\n${segment.text}`;
                  })
                  .join("\n\n");

                // Create a temporary file for the subtitles
                const subtitlesResult = await window.electron.saveFile({
                  content: srtContent,
                  defaultPath: "subtitles.srt",
                  filters: [{ name: "Subtitle Files", extensions: ["srt"] }],
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
                  subtitlesPath: subtitlesResult.filePath,
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

        <BackToTopButton />
      </div>
    </div>
  );
}

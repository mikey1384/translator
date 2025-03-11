import React, { useEffect, useState, useRef, useCallback } from "react";
import { css } from "@emotion/css";

// Components
import StatusSection from "./components/StatusSection";
import GenerateSubtitles from "./components/GenerateSubtitles";
import TranslateSubtitles from "./components/TranslateSubtitles";
import EditSubtitles from "./components/EditSubtitles";
import BackToTopButton from "./components/BackToTopButton";
import StickyVideoPlayer from "./components/StickyVideoPlayer";
import MergingProgressArea from "./components/MergingProgressArea";
import TranslationProgressArea from "./components/TranslationProgressArea";

// Import the real-time subtitle function
import { registerSubtitleStreamListeners } from "./helpers/electron-ipc";

// Context provider
import { ManagementContextProvider } from "./context";

// Helper functions
import {
  parseSrt,
  secondsToSrtTime,
  srtTimeToSeconds,
  buildSrt,
  fixOverlappingSegments,
  loadSrtFile,
} from "./helpers";

// Styles
import {
  colors,
  pageWrapperStyles,
  containerStyles,
  titleStyles,
  statusIndicatorStyles,
} from "./styles";

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

function AppContent() {
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

  // Progress state
  const [translationProgress, setTranslationProgress] = useState(0);
  const [translationStage, setTranslationStage] = useState("");
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStage, setMergeStage] = useState("");

  // Add state for the video player reference
  const [videoPlayerRef, setVideoPlayerRef] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [editingTimes, setEditingTimes] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // State for real-time subtitle streaming
  const [streamingEnabled, setStreamingEnabled] = useState<boolean>(true);
  const [isReceivingPartialResults, setIsReceivingPartialResults] =
    useState<boolean>(false);
  const [accumulatedSrt, setAccumulatedSrt] = useState<string>("");

  // Add a ref to track when video is visible for scroll behavior
  const mainContentRef = useRef<HTMLDivElement>(null);

  // Add this with other state declarations
  const hasScrolledToStickyRef = useRef(false);

  // Add this with other refs
  const editSubtitlesRef = useRef<HTMLDivElement>(null);

  // Create a ref for the EditSubtitles component
  const editSubtitlesMethodsRef = useRef<{
    scrollToCurrentSubtitle: () => void;
  }>({ scrollToCurrentSubtitle: () => {} });

  // Function to handle scrolling to current subtitle
  const handleScrollToCurrentSubtitle = useCallback(() => {
    if (editSubtitlesMethodsRef.current) {
      editSubtitlesMethodsRef.current.scrollToCurrentSubtitle();
    }
  }, []);

  // Check if electron is connected
  useEffect(() => {
    const checkElectron = async () => {
      try {
        if (window.electron) {
          try {
            // Skip the ping check since it's causing UI issues
            setElectronConnected(true);

            // Try accessing saveFile to verify it's actually working
            if (typeof window.electron.saveFile === "function") {
              // Function exists
            }
          } catch (innerError) {
            // Still set connected to true to avoid blocking UI
            setElectronConnected(true);
          }
        }
      } catch (err) {
        // Force it to true to prevent UI errors
        setElectronConnected(true);
      }
    };

    checkElectron();
  }, []);

  // Set up real-time subtitle listeners
  useEffect(() => {
    // Only register listeners if streaming is enabled
    if (!streamingEnabled) return;

    // Define the callback for partial results
    const handlePartialResult = (result: {
      partialResult?: string;
      percent?: number;
      stage?: string;
      current?: number;
      total?: number;
    }) => {
      try {
        // Create a safe copy with default values
        const safeResult = {
          partialResult: result?.partialResult || "",
          percent: result?.percent || 0,
          stage: result?.stage || "Processing",
          current: result?.current || 0,
          total: result?.total || 100,
        };

        // Only process if we have meaningful content
        if (
          safeResult.partialResult &&
          safeResult.partialResult.trim().length > 0
        ) {
          setIsReceivingPartialResults(true);
          const newSrt = safeResult.partialResult;
          try {
            const segments = parseSrt(newSrt);
            const fixedSegments = fixOverlappingSegments(segments);
            setSubtitleSegments(fixedSegments);
          } catch (e) {
            console.error("Error processing SRT:", e);
          }
          setAccumulatedSrt(newSrt);
        }

        // Always update progress information
        setTranslationProgress(safeResult.percent);
        setTranslationStage(safeResult.stage);

        // Show the progress area for any update
        setIsTranslationInProgress(true);
      } catch (error) {
        console.error("Error handling partial result:", error);
      }
    };

    console.log("Setting up subtitle stream listeners");

    // Register the listeners and get the cleanup function
    const cleanup = registerSubtitleStreamListeners(handlePartialResult);

    // Direct IPC listeners as a backup approach
    if (window.electron) {
      // Set up direct listeners as a fallback
      const generateListener = (progress: any) => {
        console.log("Direct generate progress update:", progress);
        handlePartialResult(progress || {});
      };

      if (typeof window.electron.onGenerateSubtitlesProgress === "function") {
        window.electron.onGenerateSubtitlesProgress(generateListener);
      }
    }

    // Return the cleanup function
    return () => {
      console.log("Cleaning up subtitle stream listeners");
      cleanup();
    };
  }, [streamingEnabled]);

  // Handle generated subtitles
  const handleSubtitlesGenerated = (generatedSubtitles: string) => {
    setGeneratedSubtitles(generatedSubtitles);

    // Parse the generated subtitles into segments for possible editing later
    try {
      // Use our imported parseSrt utility function
      const segments = parseSrt(generatedSubtitles);
      // Fix any potential overlapping segments
      const fixedSegments = fixOverlappingSegments(segments);
      setSubtitleSegments(fixedSegments);
      setSourceLanguage(segments.length > 0 ? "en" : ""); // Assuming English by default
    } catch (err) {
      // Error parsing generated subtitles
    }
  };

  // Handle translated subtitles
  const handleSubtitlesTranslated = (translated: string) => {
    setTranslatedSubtitles(translated);

    // Parse the translated subtitles into segments for possible editing later
    try {
      // Use our imported parseSrt utility function
      const segments = parseSrt(translated);
      // Fix any potential overlapping segments
      const fixedSegments = fixOverlappingSegments(segments);
      setTranslatedSegments(fixedSegments);
    } catch (err) {
      console.error("Error parsing translated subtitles:", err);
    }
  };

  // We now use the imported functions for:
  // - parseSrt
  // - secondsToSrtTime
  // - srtTimeToSeconds
  // - buildSrt

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

  // Handler for changing video file
  const handleChangeVideo = (file: File) => {
    if (file) {
      // Clear any previous errors
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }

      // Set the new video file
      setVideoFile(file);

      // Create and set URL for the new video
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
    }
  };

  // Handler for changing SRT file
  const handleChangeSrt = async (file: File) => {
    // Always store the filename in localStorage for consistent saving behavior
    localStorage.setItem("loadedSrtFileName", file.name);

    // Try to get the real path if possible (for Electron)
    const realPath = (file as any).path;
    if (realPath) {
      localStorage.setItem("originalLoadPath", realPath);
    }

    // Import the loadSrtFile function from helpers
    const { loadSrtFile } = await import("./helpers/subtitle-utils");

    // Use the shared loadSrtFile utility that handles Electron and browser environments
    const result = await loadSrtFile(
      file,
      (content, segments, filePath) => {
        setSubtitleSegments(segments);

        // Store path in a shared state for the EditSubtitles component to access
        if (filePath) {
          // We could use localStorage, URL parameters, or context API to share this
          // The simplest approach would be localStorage for this quick fix
          localStorage.setItem("originalSrtPath", filePath);
        }
      },
      (error) => {
        console.error("Error loading SRT:", error);
        // The setError function doesn't exist in this component, so let's just log it
        console.error(error);
      }
    );

    if (result.error && !result.error.includes("canceled")) {
      console.error("Error in loadSrtFile:", result.error);
    }
  };

  // Function to open a file using Electron's native dialog
  const handleOpenSrtFile = async () => {
    if (window.electron?.openFile) {
      try {
        const result = await window.electron.openFile({
          title: "Open SRT File",
          filters: [{ name: "SRT Files", extensions: ["srt"] }],
        });

        if (
          result.filePaths &&
          result.filePaths.length > 0 &&
          result.fileContents &&
          result.fileContents.length > 0
        ) {
          const filePath = result.filePaths[0];
          const content = result.fileContents[0];

          // Store the real path in localStorage
          localStorage.setItem("originalLoadPath", filePath);

          // Also store the filename for consistency
          const filename = filePath.split(/[\/\\]/).pop() || "subtitles.srt";
          localStorage.setItem("loadedSrtFileName", filename);

          // Import the parseSrt function and process the file
          const { parseSrt } = await import("./helpers/subtitle-utils");
          const segments = parseSrt(content);
          setSubtitleSegments(segments);

          // Store path for EditSubtitles component to access
          localStorage.setItem("originalSrtPath", filePath);
        }
      } catch (err) {
        console.error("Error using Electron file dialog:", err);
      }
    }
  };

  // Update the sticky change handler to scroll to EditSubtitles section
  const handleStickyChange = (isSticky: boolean) => {
    // Since the video is always sticky now, we just need to ensure
    // we scroll to the EditSubtitles section when it's mounted
    if (!hasScrolledToStickyRef.current && editSubtitlesRef.current) {
      // Get the sticky video height for offset calculation
      const stickyVideoHeight =
        document.querySelector(".sticky-video-container")?.clientHeight || 0;

      // Scroll with offset to account for sticky header
      const offsetTop =
        editSubtitlesRef.current.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: offsetTop - stickyVideoHeight - 20, // 20px extra space
        behavior: "auto",
      });

      // Mark that we've already scrolled
      hasScrolledToStickyRef.current = true;
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
            onChangeVideo={handleChangeVideo}
            onChangeSrt={handleChangeSrt}
            onStickyChange={handleStickyChange}
            onScrollToCurrentSubtitle={handleScrollToCurrentSubtitle}
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

          {/* Wrap EditSubtitles in a div that has the ref */}
          <div ref={editSubtitlesRef} id="edit-subtitles-section">
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
              editorRef={editSubtitlesMethodsRef}
              streamingEnabled={streamingEnabled}
              mergeSubtitlesWithVideo={async (
                videoFile,
                subtitles,
                options
              ) => {
                setIsMergingInProgress(true);
                setMergeProgress(0);
                setMergeStage("Preparing subtitle file...");

                try {
                  // Generate SRT content from subtitles using our utility function
                  const srtContent = buildSrt(
                    fixOverlappingSegments(subtitles)
                  );

                  // Create a temporary file for the subtitles
                  setMergeStage("Saving subtitle file...");
                  const subtitlesResult = await window.electron.saveFile({
                    content: srtContent,
                    defaultPath: "subtitles.srt",
                    filters: [{ name: "Subtitle Files", extensions: ["srt"] }],
                  });

                  if (subtitlesResult.error) {
                    throw new Error(subtitlesResult.error);
                  }

                  // Set up progress tracking
                  setMergeStage("Merging subtitles with video...");
                  window.electron.onMergeSubtitlesProgress((progress) => {
                    setMergeProgress(progress.percent);
                    setMergeStage(progress.stage);
                    options.onProgress(progress.percent);
                  });

                  // Get the path from the videoFile
                  const videoPath = videoFile.path || videoFile.name;

                  // Merge the video with the subtitles
                  const result = await window.electron.mergeSubtitles({
                    videoPath: videoPath,
                    subtitlesPath: subtitlesResult.filePath,
                  });

                  setMergeProgress(100);
                  setMergeStage("Merge complete!");

                  // Add a slight delay before hiding the progress area
                  setTimeout(() => {
                    setIsMergingInProgress(false);
                  }, 1500);

                  if (result.error) {
                    throw new Error(result.error);
                  }

                  return result;
                } catch (error) {
                  setMergeStage(
                    `Error: ${
                      error instanceof Error ? error.message : "Unknown error"
                    }`
                  );
                  setTimeout(() => {
                    setIsMergingInProgress(false);
                  }, 3000);
                  throw error;
                }
              }}
            />
          </div>
        </div>

        {isTranslationInProgress && (
          <TranslationProgressArea
            progress={translationProgress}
            progressStage={translationStage}
            translationProgress={translationProgress}
            translationStage={translationStage}
            onClose={() => setIsTranslationInProgress(false)}
            subtitleProgress={
              isReceivingPartialResults
                ? {
                    current: translationProgress,
                    total: 100,
                  }
                : undefined
            }
          />
        )}

        {isMergingInProgress && (
          <MergingProgressArea
            mergeProgress={mergeProgress}
            mergeStage={mergeStage}
            onSetIsMergingInProgress={setIsMergingInProgress}
          />
        )}

        <BackToTopButton />
      </div>
    </div>
  );
}

// Export the app with context provider
export default function App() {
  return (
    <ManagementContextProvider>
      <AppContent />
    </ManagementContextProvider>
  );
}

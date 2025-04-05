import { useState, ChangeEvent, useCallback, useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import Button from '../components/Button.js';
import ButtonGroup from '../components/ButtonGroup.js';
import Section from '../components/Section.js';
import { colors } from '../styles.js';
import { VideoQuality } from '../../services/url-processor.js'; // Corrected relative path
import {
  errorMessageStyles,
  selectStyles,
  fileInputWrapperStyles,
} from '../styles.js';

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

// Define Key Status Type (can be shared or redefined if needed)
type ApiKeyStatus = {
  openai: boolean;
  anthropic: boolean;
} | null;

interface GenerateSubtitlesProps {
  videoFile: File | null;
  onSetVideoFile: (file: File | any | null) => void;
  onSubtitlesGenerated: (subtitles: string) => void;
  showOriginalText: boolean;
  onShowOriginalTextChange: (show: boolean) => void;
  apiKeyStatus: ApiKeyStatus;
  isLoadingKeyStatus: boolean;
  onNavigateToSettings: (show: boolean) => void;
  subtitleSegments: { start: number; end: number; text: string }[];
  secondsToSrtTime: (seconds: number) => string;
}

// Add styles for the locked state - Dark Theme
const lockedContainerStyles = css`
  padding: 2rem 1.5rem;
  border: 1px solid ${colors.border}; // Use theme border color
  border-radius: 8px;
  background-color: ${colors.light}; // Use secondary dark background
  text-align: center;
  margin-bottom: 1rem;
`;

const lockedTitleStyles = css`
  font-size: 1.1rem;
  font-weight: 600;
  color: ${colors.dark}; // Use light text color
  margin-bottom: 0.75rem;
`;

const lockedProgressStyles = css`
  font-size: 1rem;
  color: ${colors.grayDark}; // Use secondary light text
  margin-bottom: 1.5rem;
  span {
    font-weight: bold;
    color: ${colors.primary}; // Use primary accent color
  }
`;

const goToSettingsButtonStyles = css`
  padding: 8px 16px;
  font-size: 0.9rem;
  background-color: ${colors.grayLight}; // Use surface color for background
  color: ${colors.dark}; // Use light text color
  border: 1px solid ${colors.border}; // Use theme border color
  border-radius: 6px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  box-shadow: none; // Flat design

  &:hover {
    background-color: ${colors.border}; // Slightly darker on hover
    border-color: ${colors.primary};
    color: ${colors.dark};
  }
`;

const urlInputStyles = css`
  margin-right: 8px;
  flex-grow: 1;
  min-width: 200px;
  padding: 8px 12px;
  border: 1px solid ${colors.border};
  border-radius: 4px;
  font-size: 0.95rem;
  background-color: ${colors.grayLight};
  color: ${colors.dark};
  transition: border-color 0.2s ease;

  &:focus {
    outline: none;
    border-color: ${colors.primary};
  }

  &::placeholder {
    color: ${colors.gray};
  }
`;
// --- Add Styles for URL Input ---

// --- Style Adjustments for New Layout --- START ---
const inputModeToggleStyles = css`
  display: flex;
  margin-bottom: 15px;
  border: none; // Remove all borders initially
  border-bottom: 1px solid ${colors.border}; // Add only the bottom border

  button {
    flex: 1;
    padding: 8px 12px;
    font-size: 0.95rem;
    border: none;
    background-color: transparent;
    color: ${colors.grayDark};
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      color 0.2s ease;
    border-radius: 0; // Remove individual button radius

    &:not(:last-child) {
      border-right: none; // Remove the divider line between buttons
    }

    &:hover {
      background-color: transparent;
      color: ${colors.primary};
    }

    &.active {
      background-color: transparent;
      color: ${colors.primary};
      border-bottom: 2px solid ${colors.primary};
      border-top: none;
      font-weight: 600;
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      background-color: transparent !important;
      color: ${colors.gray} !important;
    }
  }
`;

const inputSectionStyles = css`
  padding: 20px;
  border: 1px solid ${colors.border};
  border-radius: 6px;
  background-color: ${colors.light};
`;
// --- Style Adjustments for New Layout --- END ---

export default function GenerateSubtitles({
  videoFile,
  onSetVideoFile,
  showOriginalText,
  onShowOriginalTextChange,
  apiKeyStatus,
  isLoadingKeyStatus,
  onNavigateToSettings,
  subtitleSegments,
  secondsToSrtTime,
}: GenerateSubtitlesProps) {
  const [targetLanguage, setTargetLanguage] = useState<string>('original');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [urlInput, setUrlInput] = useState<string>('');
  const [isProcessingUrl, setIsProcessingUrl] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<string>('');
  const [downloadComplete, setDownloadComplete] = useState<boolean>(false);
  const [downloadedVideoPath, setDownloadedVideoPath] = useState<string | null>(
    null
  );
  const [downloadQuality, setDownloadQuality] = useState<VideoQuality>('mid');

  const progressCleanupRef = useRef<(() => void) | null>(null);

  // --- Add state for input mode --- START ---
  const [inputMode, setInputMode] = useState<'file' | 'url'>('file');
  // --- Add state for input mode --- END ---

  // Calculate key status
  const keysSetCount = apiKeyStatus
    ? (apiKeyStatus.openai ? 1 : 0) + (apiKeyStatus.anthropic ? 1 : 0)
    : 0;
  const allKeysSet = keysSetCount === 2;

  // --- New URL Handler --- Updated
  const handleProcessUrl = useCallback(async () => {
    if (!urlInput || !window.electron) {
      setError('Please enter a valid video URL');
      return;
    }

    setError('');
    setIsProcessingUrl(true);
    setProgressPercent(0);
    setProgressStage('Initializing...');
    setDownloadComplete(false); // Reset download status
    setDownloadedVideoPath(null); // Reset path
    onSetVideoFile(null); // Clear previous video
    console.log(`Processing URL: ${urlInput}`);

    // Clear previous listener if any
    progressCleanupRef.current?.();

    try {
      // --- Set up progress listener ---
      progressCleanupRef.current = window.electron.onProcessUrlProgress(
        progress => {
          console.log('URL Progress Update:', progress);
          setProgressPercent(progress.percent ?? progressPercent); // Use previous if undefined
          setProgressStage(progress.stage ?? progressStage); // Use previous if undefined
          if (progress.error) {
            setError(`Error during processing: ${progress.error}`);
            setIsProcessingUrl(false); // Stop loading on error
          }
        }
      );

      // --- Call main process handler to download video ---
      const result = await window.electron.processUrl({
        url: urlInput,
        quality: downloadQuality, // Pass selected quality
        // targetLanguage, // Removed as it's not needed for download
      });

      // --- Handle result ---
      if (result.error) {
        throw new Error(result.error);
      }

      console.log('Video download successful:', result);

      // --- MODIFIED: Use Blob URL Strategy --- START ---
      if (result.videoPath && result.filename) {
        // Update progress UI
        setProgressStage('Download complete! Reading video data...');
        setProgressPercent(100); // Keep progress at 100

        // Store download info for the "Save Original" button
        setDownloadComplete(true);
        setDownloadedVideoPath(result.videoPath);

        // Read the downloaded file content
        const fileContentResult = await window.electron.readFileContent(
          result.videoPath
        );

        if (!fileContentResult.success || !fileContentResult.data) {
          throw new Error(
            fileContentResult.error ||
              'Failed to read downloaded video content.'
          );
        }

        // Create a Blob from the ArrayBuffer
        const blob = new Blob([fileContentResult.data], { type: 'video/mp4' }); // Assuming MP4, adjust if needed

        // Create a Blob URL
        const blobUrl = URL.createObjectURL(blob);

        // Create a File-like object to pass to onSetVideoFile
        // We need name and size for display/validation, but use the Blob URL
        const videoFileObj = new File([blob], result.filename, {
          type: 'video/mp4',
        });
        // Attach the blobUrl and the original path for reference
        (videoFileObj as any)._blobUrl = blobUrl;
        (videoFileObj as any)._originalPath = result.videoPath;

        // Update progress UI
        setProgressStage('Setting up video...');

        // Set the video file in the parent component, App will handle creating the URL
        console.log(
          '[GenerateSubtitles] Calling onSetVideoFile with Blob-based file object:',
          {
            name: videoFileObj.name,
            size: videoFileObj.size,
            _blobUrl: blobUrl,
          }
        );
        onSetVideoFile(videoFileObj); // Pass the File object

        // Clear URL input since we now have a file/URL
        setUrlInput('');
      } else {
        throw new Error(
          'Downloaded video information is incomplete (missing path or filename).'
        );
      }
      // --- MODIFIED: Use Blob URL Strategy --- END ---
    } catch (err: any) {
      console.error('Error processing URL or reading file:', err);
      setError(`Error processing URL: ${err.message || err}`);
      setProgressStage('Error'); // Update stage on error
      setProgressPercent(0); // Reset progress on error
      setDownloadComplete(false); // Reset on error
      setDownloadedVideoPath(null);
    } finally {
      setIsProcessingUrl(false); // Indicate URL processing end (success or fail)

      // Cleanup listener
      progressCleanupRef.current?.();
      progressCleanupRef.current = null;
    }
  }, [
    urlInput,
    // targetLanguage, // Removed dependency
    downloadQuality, // Add dependency
    onSetVideoFile,
    progressPercent, // Keep these if needed by listener logic
    progressStage, // Keep these if needed by listener logic
  ]);

  // --- handleGenerateSubtitles (define BEFORE useEffect that uses it) ---
  const handleGenerateSubtitles = useCallback(async () => {
    if (!videoFile || !window.electron) {
      setError('Please select a video file first');
      return;
    }

    try {
      setError('');
      setIsGenerating(true);

      // --- Get API Keys from Main Process ---
      // Removed as it's handled differently now (passed as prop or context)

      // --- Prepare options ---
      const options: any = {
        targetLanguage,
        streamResults: true, // Assuming streaming is desired
      };

      // Check if videoFile has a path (local file or downloaded)
      if (videoFile.path) {
        options.videoPath = videoFile.path;
      } else {
        // Standard browser File object - needs to be handled via preload
        options.videoFile = videoFile;
      }

      console.log('Calling window.electron.generateSubtitles with:', {
        ...options,
        videoFile: options.videoFile
          ? {
              name: options.videoFile.name,
              size: options.videoFile.size,
              type: options.videoFile.type,
            }
          : undefined, // Log file info, not the object itself
      });

      // --- Call Main Process ---
      const result = await window.electron.generateSubtitles(options);

      // --- Handle Result ---
      if (result.error) {
        throw new Error(result.error);
      }

      // The hook useSubtitleManagement now handles setting segments via IPC
      // console.log('Subtitles received:', result.subtitles.substring(0, 100) + '...');
      // setSubtitles(result.subtitles);
      // onSubtitlesGenerated(result.subtitles);
    } catch (err: any) {
      console.error('Error generating subtitles:', err);
      setError(`Error generating subtitles: ${err.message || err}`);
      // Reset progress on error?
      // setProgressStage('Error');
      // setProgressPercent(0);
    } finally {
      setIsGenerating(false);
    }
  }, [videoFile, targetLanguage, setError, setIsGenerating]); // Ensure dependencies are correct

  // --- Cleanup listener on unmount --- (Original useEffect for progress)
  useEffect(() => {
    // Return the cleanup function stored in the ref
    return () => {
      progressCleanupRef.current?.();
    };
  }, []);

  // --- MODIFIED: Trigger Electron dialog for file selection --- START ---
  const handleFileSelectClick = async () => {
    setError('');
    if (!window.electron?.openFile) {
      console.error('Electron openFile API is not available.');
      setError('Error: Cannot open file dialog.');
      return;
    }
    try {
      const result = await window.electron.openFile({
        filters: [
          {
            name: 'Video Files',
            extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'],
          },
        ],
        title: 'Select Video File',
      });

      if (result.canceled || !result.filePaths?.length) {
        console.log('Video selection cancelled.');
        // Don't clear existing file if selection is cancelled
        return;
      }

      const filePath = result.filePaths[0];
      console.log('Selected video file path via Electron:', filePath);

      // Construct a pseudo-File object with the path
      const fileData = {
        name: filePath.split(/[\\/]/).pop() || 'video.mp4', // Extract filename
        path: filePath,
        size: 0, // Placeholder - size might need to be fetched if required
        type: '', // Placeholder
      };

      onSetVideoFile(fileData as any); // Pass the object with path
      setUrlInput(''); // Clear URL input if file is selected
      setInputMode('file'); // Ensure mode is set to file
    } catch (error: any) {
      console.error('Error opening video file with Electron:', error);
      setError(`Error selecting file: ${error.message || error}`);
    }
  };
  // --- MODIFIED: Trigger Electron dialog for file selection --- END ---

  // --- handleSaveSubtitles (corrected) ---
  async function handleSaveSubtitles() {
    // Use subtitleSegments from the useSubtitleManagement hook
    if (
      !subtitleSegments ||
      subtitleSegments.length === 0 ||
      !window.electron
    ) {
      setError('No subtitles to save');
      return;
    }

    try {
      // Build SRT content from segments
      const srtContent = subtitleSegments
        .map(
          (seg, index) =>
            `${index + 1}\n${secondsToSrtTime(seg.start)} --> ${secondsToSrtTime(seg.end)}\n${seg.text}`
        )
        .join('\n\n');

      const result = await window.electron.saveFile({
        content: srtContent,
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

  // --- Function to Save Original Downloaded Video --- START ---
  const handleSaveOriginalVideo = useCallback(async () => {
    if (!downloadedVideoPath) {
      setError('Downloaded video path not found.');
      return;
    }

    const suggestedName = downloadedVideoPath.includes('ytdl_')
      ? downloadedVideoPath.substring(downloadedVideoPath.indexOf('ytdl_') + 5)
      : 'downloaded_video.mp4';

    try {
      // Step 1: Get the desired destination path using saveFile dialog
      const saveDialogResult = await window.electron.saveFile({
        content: '', // No content, just getting path
        defaultPath: suggestedName,
        title: 'Save Downloaded Video As',
        filters: [{ name: 'Video Files', extensions: ['mp4', 'mkv', 'webm'] }],
      });

      // Handle dialog cancellation or error
      if (saveDialogResult.error) {
        if (saveDialogResult.error.includes('canceled')) {
          setError(''); // Clear error if user cancelled
          return; // Exit if cancelled
        } else {
          throw new Error(`Failed to get save path: ${saveDialogResult.error}`);
        }
      }

      if (!saveDialogResult.filePath) {
        // This shouldn't happen if error handling is correct, but good to check
        setError('Save path was not selected.');
        return;
      }

      const destinationPath = saveDialogResult.filePath;

      // Step 2: Copy the downloaded file to the chosen destination
      setError(''); // Clear previous errors
      // Indicate copy is happening? Optional: add more state
      const copyResult = await window.electron.copyFile(
        downloadedVideoPath,
        destinationPath
      );

      if (copyResult.error) {
        throw new Error(`Failed to copy video: ${copyResult.error}`);
      }

      window.electron.showMessage(`Video saved to: ${destinationPath}`);
      // Keep the state so the button remains visible
      // setDownloadedVideoPath(null);
      // setDownloadComplete(false);
    } catch (err: any) {
      console.error('Error copying original video:', err);
      setError(`Error saving video: ${err.message || err}`);
    }
  }, [downloadedVideoPath]);
  // --- Function to Save Original Downloaded Video --- END ---

  return (
    <Section title="1. Select Video Source">
      {isLoadingKeyStatus && <p>Loading API Key status...</p>}

      {!isLoadingKeyStatus && !allKeysSet && (
        <div className={lockedContainerStyles}>
          <div className={lockedTitleStyles}>API Key Setup Required</div>
          <div className={lockedProgressStyles}>
            Required Keys Set: <span>{keysSetCount}</span>/2
          </div>
          <p
            style={{
              fontSize: '0.9rem',
              color: colors.gray,
              marginBottom: '1rem',
            }}
          >
            Please add your OpenAI and Anthropic API keys in the settings to
            enable subtitle generation and translation.
          </p>
          <button
            className={goToSettingsButtonStyles}
            onClick={() => onNavigateToSettings(true)}
            title="Go to Settings to add API Keys"
          >
            Go to Settings
          </button>
        </div>
      )}

      {!isLoadingKeyStatus && allKeysSet && (
        <>
          {error && <div className={errorMessageStyles}>{error}</div>}

          {/* --- Progress Display OR Save Button --- START --- */}
          {isProcessingUrl && progressPercent > 0 && !downloadComplete && (
            <div
              style={{
                marginBottom: '15px',
                padding: '10px',
                border: `1px solid ${colors.border}`,
                borderRadius: '4px',
                backgroundColor: colors.light,
              }}
            >
              <div
                style={{
                  marginBottom: '5px',
                  fontSize: '0.9em',
                  color: colors.grayDark,
                }}
              >
                {progressStage}
              </div>
              <div
                style={{
                  height: '8px',
                  backgroundColor: colors.grayLight,
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${progressPercent}%`,
                    height: '100%',
                    backgroundColor: colors.primary,
                    transition: 'width 0.2s ease-out',
                  }}
                />
              </div>
            </div>
          )}
          {downloadComplete && downloadedVideoPath && (
            <div style={{ marginBottom: '15px', textAlign: 'center' }}>
              <Button
                variant="success"
                size="sm"
                onClick={handleSaveOriginalVideo}
                title={`Save the downloaded file: ${downloadedVideoPath}`}
              >
                Save Original Video
              </Button>
            </div>
          )}
          {/* --- Progress Display OR Save Button --- END --- */}

          {/* --- Input Mode Toggle --- START --- */}
          <div className={inputModeToggleStyles}>
            <button
              className={inputMode === 'file' ? 'active' : ''}
              onClick={() => setInputMode('file')}
              disabled={isGenerating || isProcessingUrl}
            >
              Upload File
            </button>
            <button
              className={inputMode === 'url' ? 'active' : ''}
              onClick={() => setInputMode('url')}
              disabled={isGenerating || isProcessingUrl}
            >
              Enter URL
            </button>
          </div>
          {/* --- Input Mode Toggle --- END --- */}

          {/* --- Conditional Input Sections --- START --- */}
          {inputMode === 'file' && (
            <div className={inputSectionStyles}>
              <div
                className={css`
                  display: flex;
                  align-items: center;
                  padding: 5px 0;
                  height: 35px;
                `}
              >
                <label
                  style={{
                    marginRight: '12px',
                    lineHeight: '32px', // Match button height
                    display: 'inline-block',
                    minWidth: '220px', // Fixed width for both labels
                  }}
                >
                  1. Select Video File:{' '}
                </label>
                <Button
                  onClick={handleFileSelectClick}
                  variant="secondary"
                  className={css`
                    width: 100%;
                    justify-content: center;
                    padding: 10px;
                    margin-top: 5px;
                  `}
                >
                  {videoFile
                    ? `Selected: ${videoFile.name}`
                    : 'Select Video File'}
                </Button>
              </div>
            </div>
          )}

          {inputMode === 'url' && (
            <div className={inputSectionStyles}>
              <div
                className={css`
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 5px 0;
                  height: 35px;
                  gap: 8px;
                `}
              >
                <label
                  style={{
                    marginRight: '12px',
                    lineHeight: '32px', // Match input height
                    display: 'inline-block',
                    minWidth: '100px',
                  }}
                >
                  1. Enter URL:
                </label>
                <input
                  type="url"
                  className={urlInputStyles}
                  placeholder="Enter YouTube or direct video URL"
                  value={urlInput}
                  onChange={e => {
                    setUrlInput(e.target.value);
                    if (e.target.value) {
                      // If user starts typing URL, clear any selected file
                      onSetVideoFile(null);
                      setError('');
                    }
                  }}
                  disabled={isGenerating || isProcessingUrl}
                />
                <div
                  className={css`
                    position: relative;
                    min-width: 120px;
                  `}
                >
                  <label
                    htmlFor="quality-select"
                    className={css`
                      /* Add screen-reader only styles if needed */
                      position: absolute;
                      width: 1px;
                      height: 1px;
                      margin: -1px;
                      padding: 0;
                      overflow: hidden;
                      clip: rect(0, 0, 0, 0);
                      border: 0;
                    `}
                  >
                    Quality
                  </label>
                  <select
                    id="quality-select"
                    value={downloadQuality}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                      setDownloadQuality(e.target.value as VideoQuality)
                    }
                    disabled={isProcessingUrl || isGenerating}
                    className={selectStyles} // Apply existing select styles
                    style={{ minWidth: '120px' }}
                  >
                    <option value="high">High</option>
                    <option value="mid">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <Button
                  onClick={handleProcessUrl}
                  disabled={!urlInput || isProcessingUrl || isGenerating}
                  isLoading={isProcessingUrl}
                  size="md"
                  variant="secondary"
                >
                  {isProcessingUrl ? 'Processing...' : 'Process URL'}
                </Button>
              </div>
            </div>
          )}
          {/* --- Conditional Input Sections --- END --- */}

          {/* --- Output Language Selection (Moved to step 2) --- START --- */}
          {videoFile && (
            <Section title="2. Select Output Language" isSubSection>
              <div className={fileInputWrapperStyles}>
                <label>Output Language: </label>
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
                {targetLanguage !== 'original' &&
                  targetLanguage !== 'english' && (
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
                          onChange={e =>
                            onShowOriginalTextChange(e.target.checked)
                          }
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
            </Section>
          )}
          {/* --- Output Language Selection --- END --- */}

          {/* --- Generate Button (Moved to step 3) --- START --- */}
          {videoFile && (
            <Section title="3. Generate Subtitles" isSubSection>
              <ButtonGroup>
                {/* Main Generate Button is now outside conditional inputs */}
                <Button
                  onClick={handleGenerateSubtitles}
                  disabled={!videoFile || isGenerating || isProcessingUrl}
                  size="md"
                  variant="primary"
                  isLoading={isGenerating}
                >
                  {isGenerating ? 'Generating...' : 'Generate Subtitles Now'}
                </Button>

                {/* Save SRT button - condition unchanged */}
                {subtitleSegments && subtitleSegments.length > 0 && (
                  <Button
                    variant="secondary"
                    onClick={handleSaveSubtitles}
                    size="md"
                  >
                    Save SRT
                  </Button>
                )}
              </ButtonGroup>
            </Section>
          )}
          {/* --- Generate Button --- END --- */}
        </>
      )}
    </Section>
  );
}

import React, { useEffect, useRef } from 'react';
import { useAppContext } from '~/contexts/hooks';
import { css } from '@emotion/css';
import Button from './Button';
import StylizedFileInput from './StylizedFileInput';
import { selectStyles, fileInputWrapperStyles } from './styles';
import { translationStates } from '~/constants/state';
import { parseSrt } from './utils';

interface GenerateSubtitlesProps {
  MAX_MB: number;
  selectedFile: File | null;
  targetLanguage: string;
  showOriginalText: boolean;
  loading: boolean;
  onSetSelectedFile: (file: File) => void;
  onSetTargetLanguage: (language: string) => void;
  onSetShowOriginalText: (show: boolean) => void;
  onSetLoading: (loading: boolean) => void;
  onSetError: (error: string) => void;
  onSetProgress: (progress: number) => void;
  onSetProgressStage: (stage: string) => void;
  onSetTranslationProgress: (progress: number) => void;
  onSetTranslationStage: (stage: string) => void;
  onSetIsTranslationInProgress: (inProgress: boolean) => void;
  onSetVideoFile: (file: File | null) => void;
  onSetSubtitles: (subtitles: any[]) => void;
}

export default function GenerateSubtitles({
  MAX_MB,
  selectedFile,
  targetLanguage,
  showOriginalText,
  loading,
  onSetSelectedFile,
  onSetTargetLanguage,
  onSetShowOriginalText,
  onSetLoading,
  onSetError,
  onSetProgress,
  onSetProgressStage,
  onSetTranslationProgress,
  onSetTranslationStage,
  onSetIsTranslationInProgress,
  onSetVideoFile,
  onSetSubtitles
}: GenerateSubtitlesProps) {
  const generateVideoSubtitles = useAppContext(
    (v) => v.requestHelpers.generateVideoSubtitles
  );
  const MAX_FILE_SIZE = MAX_MB * 1024 * 1024;
  const sessionIdRef = useRef<string>(`translation-${Date.now()}`);
  useEffect(() => {
    if (onSetIsTranslationInProgress) {
      if (
        !translationStates[sessionIdRef.current] ||
        !translationStates[sessionIdRef.current].inProgress
      ) {
        onSetIsTranslationInProgress(false);
        onSetProgress(0);
        onSetProgressStage('');
        onSetTranslationProgress(0);
        onSetTranslationStage('');
      }
    }

    if (!translationStates[sessionIdRef.current]) {
      translationStates[sessionIdRef.current] = {
        inProgress: false,
        audioProgress: 0,
        audioStage: '',
        translationProgress: 0,
        translationStage: '',
        completedTimestamp: 0
      };
    }

    const sessionId = sessionIdRef.current;
    return () => {
      if (translationStates[sessionId]) {
        if (
          translationStates[sessionId].translationProgress >= 100 ||
          translationStates[sessionId].translationStage === 'Complete'
        ) {
          translationStates[sessionId].inProgress = false;
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className={fileInputWrapperStyles}>
        <label>1. Select Video File (up to {MAX_MB}MB): </label>
        <StylizedFileInput
          accept="video/*"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              onSetSelectedFile(e.target.files[0]);
            }
          }}
          label=""
          buttonText="Choose Video"
          selectedFile={loading ? null : selectedFile}
        />
      </div>

      <div className={fileInputWrapperStyles}>
        <label>2. Output Language: </label>
        <select
          value={targetLanguage}
          onChange={(e) => onSetTargetLanguage(e.target.value)}
          className={selectStyles}
        >
          <option value="original">Same as Audio</option>
          <option value="english">Translate to English</option>
          <option value="korean">Translate to Korean</option>
          <option value="spanish">Translate to Spanish</option>
          <option value="french">Translate to French</option>
          <option value="german">Translate to German</option>
          <option value="chinese">Translate to Chinese</option>
          <option value="japanese">Translate to Japanese</option>
          <option value="russian">Translate to Russian</option>
          <option value="portuguese">Translate to Portuguese</option>
          <option value="italian">Translate to Italian</option>
          <option value="arabic">Translate to Arabic</option>
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
                onChange={(e) => onSetShowOriginalText(e.target.checked)}
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

      <Button
        onClick={handleFileUpload}
        disabled={!selectedFile || loading}
        size="md"
        variant="primary"
        isLoading={loading}
      >
        {loading ? 'Processing...' : 'Generate Subtitles'}
      </Button>
    </div>
  );

  async function handleFileUpload() {
    onSetError('');
    onSetProgress(0);
    onSetProgressStage('');
    onSetTranslationProgress(0);
    onSetTranslationStage('');

    // Update both UI and global state
    onSetIsTranslationInProgress(true);
    translationStates[sessionIdRef.current] = {
      inProgress: true,
      audioProgress: 0,
      audioStage: 'Preparing',
      translationProgress: 0,
      translationStage: '',
      completedTimestamp: 0
    };

    if (!selectedFile) {
      onSetError('No file selected');
      onSetIsTranslationInProgress(false);
      translationStates[sessionIdRef.current].inProgress = false;
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      onSetError(`File exceeds ${MAX_MB}MB limit`);
      onSetIsTranslationInProgress(false);
      translationStates[sessionIdRef.current].inProgress = false;
      return;
    }

    // Pass the file to parent's handler which creates URL
    onSetVideoFile(selectedFile);

    const isLargeFile = selectedFile.size > 100 * 1024 * 1024;
    if (isLargeFile) {
      try {
        onSetLoading(true);
        onSetProgressStage('Preparing file for chunked upload');

        const CHUNK_SIZE = 5 * 1024 * 1024;
        const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);
        const uploadedChunkIndexes = new Set();

        const sessionId = `${Date.now()}-${selectedFile.name.replace(
          /[^a-zA-Z0-9]/g,
          '_'
        )}`;
        const sessionFilename = `${sessionId}`;

        const uploadChunkWithRetry = async (
          chunk: Blob,
          chunkIndex: number,
          isLastChunk: boolean,
          maxRetries = 3
        ) => {
          let retries = 0;

          while (retries < maxRetries) {
            try {
              const reader = new FileReader();

              const chunkArrayBuffer = await new Promise<ArrayBuffer>(
                (resolve, reject) => {
                  const timeout = setTimeout(() => {
                    reject(new Error('File read operation timed out'));
                  }, 30000);

                  reader.onload = () => {
                    clearTimeout(timeout);
                    if (reader.result instanceof ArrayBuffer) {
                      resolve(reader.result);
                    } else {
                      reject(new Error('Failed to read file as ArrayBuffer'));
                    }
                  };
                  reader.onerror = (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`File read error: ${e}`));
                  };
                  reader.readAsArrayBuffer(chunk);
                }
              );

              let binary = '';
              const bytes = new Uint8Array(chunkArrayBuffer);
              const len = bytes.byteLength;

              for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
              }

              const base64 = btoa(binary);
              const chunkBase64 = `data:${selectedFile.type};base64,${base64}`;

              const response = await generateVideoSubtitles({
                chunk: chunkBase64,
                targetLanguage,
                filename: sessionFilename,
                chunkIndex,
                totalChunks,
                contentType: selectedFile.type,
                processAudio: isLastChunk,
                onProgress: (progress: number) => {
                  const chunkProgress = progress / 100;
                  const overallProgress = Math.round(
                    ((chunkIndex + chunkProgress) / totalChunks) * 100
                  );
                  onSetProgress(overallProgress);

                  if (isLastChunk && progress >= 99) {
                    onSetProgressStage('Processing audio');
                    onSetProgress(100);

                    onSetTranslationStage('Starting transcription');
                    onSetTranslationProgress(0);
                  }
                }
              });

              if (!response || response.error) {
                throw new Error(
                  response?.error || 'Unknown error during upload'
                );
              }

              return response;
            } catch (error) {
              retries++;
              console.error(
                `Chunk ${chunkIndex} upload failed (attempt ${retries}/${maxRetries}):`,
                error
              );

              if (retries >= maxRetries) {
                throw error;
              }

              await new Promise((resolve) =>
                setTimeout(resolve, 1000 * Math.pow(2, retries))
              );
              onSetProgressStage(
                `Retrying chunk ${chunkIndex + 1}/${totalChunks} (attempt ${
                  retries + 1
                }/${maxRetries})`
              );
            }
          }
        };

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          const start = chunkIndex * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
          const chunk = selectedFile.slice(start, end);
          const isLastChunk = chunkIndex === totalChunks - 1;

          onSetProgressStage(
            `Uploading chunk ${chunkIndex + 1} of ${totalChunks}`
          );

          try {
            const response = await uploadChunkWithRetry(
              chunk,
              chunkIndex,
              isLastChunk
            );

            uploadedChunkIndexes.add(chunkIndex);

            if (isLastChunk && response.srt) {
              if (uploadedChunkIndexes.size !== totalChunks) {
                const missing = [];
                for (let i = 0; i < totalChunks; i++) {
                  if (!uploadedChunkIndexes.has(i)) {
                    missing.push(i);
                  }
                }
                console.error(`Missing chunks: ${missing.join(', ')}`);
                throw new Error(
                  `Upload incomplete. Missing ${missing.length} chunks.`
                );
              }

              const parsedSegments = parseSrt(
                response.srt,
                targetLanguage,
                showOriginalText
              );

              // Update the subtitles state in the parent component

              onSetSubtitles(parsedSegments);

              onSetTranslationStage('Complete');
              onSetTranslationProgress(100);
              onSetIsTranslationInProgress(false);

              const completeStage = 'Complete';
              onSetTranslationStage(completeStage);
              if (translationStates[sessionIdRef.current]) {
                translationStates[sessionIdRef.current].translationStage =
                  completeStage;
                translationStates[
                  sessionIdRef.current
                ].translationProgress = 100;
                translationStates[sessionIdRef.current].completedTimestamp =
                  Date.now();
                translationStates[sessionIdRef.current].inProgress = false;
              }

              setTimeout(() => {
                onSetIsTranslationInProgress(false);
              }, 2000);
            }
          } catch (error) {
            console.error('Error during chunked upload:', error);
            onSetError(
              error instanceof Error
                ? error.message
                : 'An error occurred during chunked upload'
            );
            onSetIsTranslationInProgress(false);
          }
        }
      } catch (error) {
        console.error('Error during chunked upload:', error);
        onSetError(
          error instanceof Error
            ? error.message
            : 'An error occurred during chunked upload'
        );
        onSetIsTranslationInProgress(false);
      } finally {
        onSetLoading(false);
      }
      return;
    }

    onSetLoading(true);
    onSetProgressStage('Preparing file');

    try {
      const reader = new FileReader();
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });

      onSetProgressStage('Uploading file');

      const response = await generateVideoSubtitles({
        chunk: fileBase64,
        targetLanguage,
        filename: selectedFile.name,
        contentType: selectedFile.type,
        processAudio: true,
        onProgress: (progress: number) => {
          onSetProgress(progress);
          if (progress >= 99) {
            onSetProgressStage('Processing audio');
            onSetProgress(100);

            onSetTranslationStage('Starting transcription');
            onSetTranslationProgress(0);
          }
        }
      });

      if (!response || !response.srt) {
        throw new Error('No SRT data received from server');
      }

      const parsedSegments = parseSrt(
        response.srt,
        targetLanguage,
        showOriginalText
      );

      onSetSubtitles(parsedSegments);

      onSetTranslationStage('Complete');
      onSetTranslationProgress(100);
      onSetIsTranslationInProgress(false);

      const completeStage = 'Complete';
      onSetTranslationStage(completeStage);
      if (translationStates[sessionIdRef.current]) {
        translationStates[sessionIdRef.current].translationStage =
          completeStage;
        translationStates[sessionIdRef.current].translationProgress = 100;
        translationStates[sessionIdRef.current].completedTimestamp = Date.now();
        translationStates[sessionIdRef.current].inProgress = false;
      }

      setTimeout(() => {
        onSetIsTranslationInProgress(false);
      }, 2000);
    } catch (error) {
      console.error('Error:', error);
      onSetError(
        error instanceof Error
          ? error.message
          : 'An error occurred while generating subtitles'
      );
      onSetIsTranslationInProgress(false);
    } finally {
      onSetLoading(false);
    }
  }
}

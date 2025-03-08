import React, { useState, useEffect } from 'react';
import { useManagementContext } from '~/contexts';
import EditSubtitles from './EditSubtitles';
import GenerateSubtitles from './GenerateSubtitles';
import TranslationProgressArea from './TranslationProgressArea';
import MergingProgressArea from './MergingProgressArea';
import BackToTopButton from './BackToTopButton';
import { parseSrt, secondsToSrtTime } from './utils';
import { css } from '@emotion/css';
import Section from './Section';
import { subtitlesState, subtitleVideoPlayer } from '~/constants/state';
import { SrtSegment } from '~/types';

// Modern design system constants
const colors = {
  primary: '#4361ee',
  primaryLight: '#4895ef',
  primaryDark: '#3a0ca3',
  secondary: '#3f37c9',
  success: '#4cc9f0',
  info: '#4895ef',
  warning: '#f72585',
  danger: '#e63946',
  light: '#f8f9fa',
  dark: '#212529',
  gray: '#6c757d',
  grayLight: '#f1f3f5',
  grayDark: '#343a40',
  white: '#ffffff'
};

// Main container styles
const containerStyles = css`
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
`;

// Main title styles
const mainTitleStyles = css`
  font-size: 2.5rem;
  color: ${colors.dark};
  margin-bottom: 2rem;
  font-weight: 700;
`;

// Error styles
const errorStyles = css`
  background-color: ${colors.danger};
  color: ${colors.white};
  padding: 1rem;
  border-radius: 0.5rem;
  margin-bottom: 2rem;
  font-weight: 500;
`;

export default function Tools() {
  const onSetIsTranslationInProgress = useManagementContext(
    (v) => v.actions.onSetIsTranslationInProgress
  );
  const onSetIsMergingInProgress = useManagementContext(
    (v) => v.actions.onSetIsMergingInProgress
  );
  const onSetVideoFile = useManagementContext((v) => v.actions.onSetVideoFile);
  const onSetVideoUrl = useManagementContext((v) => v.actions.onSetVideoUrl);

  const isTranslationInProgress = useManagementContext(
    (v) => v.state.isTranslationInProgress
  );
  const isMergingInProgress = useManagementContext(
    (v) => v.state.isMergingInProgress
  );
  const videoFile = useManagementContext((v) => v.state.videoFile);
  const videoUrl = useManagementContext((v) => v.state.videoUrl);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [subtitles, setSubtitles] = useState<SrtSegment[]>(
    subtitlesState.segments
  );
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<string>('');
  const [translationProgress, setTranslationProgress] = useState<number>(0);
  const [translationStage, setTranslationStage] = useState<string>('');
  const [targetLanguage, setTargetLanguage] = useState('original');
  const [showOriginalText, setShowOriginalText] = useState(true);
  const [mergeProgress, setMergeProgress] = useState<number>(0);
  const [mergeStage, setMergeStage] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [editingTimes, setEditingTimes] = useState<any>({});

  const MAX_MB = 2500;

  const subtitleProgress = useManagementContext(
    (v) => v.state.subtitleTranslationProgress
  );

  const subtitleMergeProgress = useManagementContext(
    (v) => v.state.subtitleMergeProgress
  );

  // Initialize subtitlesState with data from props
  useEffect(() => {
    if (subtitles.length > 0 && subtitlesState.segments.length === 0) {
      subtitlesState.segments = [...subtitles];
      subtitlesState.lastEdited = Date.now();
    }
  }, [subtitles]);

  useEffect(() => {
    return () => {
      subtitlesState.segments = [...subtitles];
    };
  }, [subtitles]);

  useEffect(() => {
    if (subtitleProgress) {
      setTranslationProgress(subtitleProgress.progress);
      setTranslationStage(subtitleProgress.stage);

      if (subtitleProgress.progress > 0) {
        onSetIsTranslationInProgress(true);
      }

      if (subtitleProgress.progress === 100) {
        setTimeout(() => {
          onSetIsTranslationInProgress(false);
          subtitleProgress.progress = 0;
          subtitleProgress.stage = '';
        }, 2000);
      }

      if (subtitleProgress.error) {
        setError(subtitleProgress.error);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitleProgress]);

  useEffect(() => {
    if (subtitleMergeProgress) {
      setMergeProgress(subtitleMergeProgress.progress);
      setMergeStage(subtitleMergeProgress.stage);

      if (subtitleMergeProgress.progress > 0) {
        onSetIsMergingInProgress(true);
      }

      if (subtitleMergeProgress.progress === 100) {
        setTimeout(() => {
          onSetIsMergingInProgress(false);
          subtitleMergeProgress.progress = 0;
          subtitleMergeProgress.stage = '';
        }, 2000);
      }

      if (subtitleMergeProgress.error) {
        setError(subtitleMergeProgress.error);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitleMergeProgress]);

  return (
    <div
      className={containerStyles}
      style={{
        paddingTop: isTranslationInProgress ? 180 : 80
      }}
    >
      <div id="top-padding" />

      <h1 className={mainTitleStyles}>Subtitle + Translation Tools</h1>

      {error && <div className={errorStyles}>{error}</div>}

      <Section title="Generate Subtitles">
        <GenerateSubtitles
          MAX_MB={MAX_MB}
          selectedFile={selectedFile}
          targetLanguage={targetLanguage}
          showOriginalText={showOriginalText}
          loading={loading}
          onSetSelectedFile={setSelectedFile}
          onSetTargetLanguage={setTargetLanguage}
          onSetShowOriginalText={setShowOriginalText}
          onSetLoading={setLoading}
          onSetError={setError}
          onSetProgress={setProgress}
          onSetProgressStage={setProgressStage}
          onSetSubtitles={setSubtitles}
          onSetTranslationProgress={setTranslationProgress}
          onSetTranslationStage={setTranslationStage}
          onSetIsTranslationInProgress={onSetIsTranslationInProgress}
          onSetVideoFile={handleSetVideoFile}
        />
      </Section>

      <Section title="Edit Subtitles">
        <EditSubtitles
          videoFile={videoFile}
          videoUrl={videoUrl}
          subtitles={subtitles}
          isPlaying={isPlaying}
          editingTimes={editingTimes}
          targetLanguage={targetLanguage}
          showOriginalText={showOriginalText}
          isMergingInProgress={isMergingInProgress}
          onSetEditingTimes={setEditingTimes}
          onSetVideoFile={handleSetVideoFile}
          onSetVideoUrl={onSetVideoUrl}
          onSetError={setError}
          secondsToSrtTime={secondsToSrtTime}
          parseSrt={parseSrt}
          onSetIsMergingInProgress={onSetIsMergingInProgress}
          onSetMergeProgress={setMergeProgress}
          onSetMergeStage={setMergeStage}
          onSetIsPlaying={setIsPlaying}
          onSetSubtitles={setSubtitles}
        />
      </Section>

      {isTranslationInProgress && (
        <TranslationProgressArea
          progress={progress}
          progressStage={progressStage}
          translationProgress={translationProgress}
          translationStage={translationStage}
          onSetIsTranslationInProgress={onSetIsTranslationInProgress}
          subtitleProgress={subtitleProgress}
        />
      )}

      {isMergingInProgress && (
        <MergingProgressArea
          mergeProgress={mergeProgress}
          mergeStage={mergeStage}
          onSetIsMergingInProgress={onSetIsMergingInProgress}
        />
      )}

      <BackToTopButton
        showButton={subtitles.length > 0}
        onClick={() => {
          const topPadding = document.getElementById('top-padding');
          if (topPadding) {
            topPadding.scrollIntoView({ behavior: 'smooth' });
          }
        }}
      />
      <div style={{ height: 100 }} />
    </div>
  );

  function handleSetVideoFile(file: File | null) {
    // Clear the subtitleVideoPlayer global reference first
    if (subtitleVideoPlayer.instance) {
      try {
        subtitleVideoPlayer.instance.dispose();
      } catch (e) {
        console.error('Error disposing video player:', e);
      }
      subtitleVideoPlayer.instance = null;
      subtitleVideoPlayer.isReady = false;
    }

    onSetVideoFile(file);

    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }

    if (file) {
      try {
        // Don't create a new Blob, use the File directly (File extends Blob)
        const url = URL.createObjectURL(file);

        // Extract file extension and ensure we have a valid MIME type
        const fileExt = file.name.split('.').pop()?.toLowerCase() || 'mp4';
        const mimeType = file.type || `video/${fileExt}` || 'video/mp4';

        // Adding type hints as URL hash parameters
        const typeHint = `${url}#type=${encodeURIComponent(
          mimeType
        )}&ext=${encodeURIComponent(fileExt)}`;

        onSetVideoUrl(typeHint);
      } catch (error) {
        console.error('Error creating object URL:', error);
        setError(
          'Error preparing video for playback. Please try again or use a different file.'
        );
      }
    } else {
      onSetVideoUrl('');
    }
  }
}

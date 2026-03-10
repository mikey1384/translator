import Button from '../../components/Button';
import IconButton from '../../components/IconButton';
import {
  AudioLines,
  CircleAlert,
  Download,
  FileText,
  Languages,
  LocateFixed,
  Mic,
  Save,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  useSubStore,
  useTaskStore,
  useUIStore,
  useVideoStore,
} from '../../state';
import { openChangeVideo, openUnsavedSrtConfirm } from '../../state/modal-store';
import { logButton, logVideo, logError } from '../../utils/logger';
import { useTranslation } from 'react-i18next';
import { openSubtitleWithElectron } from '../../../shared/helpers';
import {
  TRANSLATION_LANGUAGES_BASE,
  TRANSLATION_LANGUAGE_GROUPS,
} from '../../constants/translation-languages';
import { runFullSrtTranslation } from '../../utils/runFullTranslation';
import {
  executeDubGeneration,
  startTranscriptionFlow,
} from '../GenerateSubtitles/utils/subtitleGeneration';
import { useVideoMetadata } from '../GenerateSubtitles/hooks/useVideoMetadata';
import {
  isManagedTempOriginalVideoPath,
  saveDubbedVideoFile,
  saveOriginalVideoFile,
} from '../../utils/saveVideo';
import {
  deleteMountedStoredSubtitle,
  unmountCurrentSubtitles,
} from '../../utils/subtitle-library';
import { saveCurrentSubtitles } from '../../utils/saveSubtitles';
import {
  sidePanelButtonContentStyles,
  sidePanelButtonRowStyles,
  sidePanelButtonWithIconsRowStyles,
  sidePanelDividerStyles,
  sidePanelFieldStackStyles,
  sidePanelLabelStyles,
  sidePanelSectionStyles,
  sidePanelSelectStyles,
  sidePanelShellStyles,
  sidePanelWarningIconStyles,
  sidePanelWarningStyles,
  sidePanelWarningTextStyles,
} from './video-player-side-styles';

export default function SideMenu({
  isFullScreen = false,
}: {
  isFullScreen?: boolean;
}) {
  const { t } = useTranslation();
  const order = useSubStore(s => s.order);
  const segments = useSubStore(s => s.segments);
  const originalSrtPath = useSubStore(s => s.originalPath);
  const libraryEntryId = useSubStore(s => s.libraryEntryId);
  const scrollToCurrent = useSubStore(s => s.scrollToCurrent);
  const hasSubs = order.length > 0;
  const setTranslation = useTaskStore(s => s.setTranslation);
  const isTranscribing = useTaskStore(s => !!s.transcription.inProgress);
  const isMerging = useTaskStore(s => !!s.merge.inProgress);
  const isDubbing = useTaskStore(s => !!s.dubbing.inProgress);
  const transcriptionIsCompleted = useTaskStore(
    s => !!s.transcription.isCompleted
  );
  const translationInProgress = useTaskStore(s => !!s.translation.inProgress);
  const targetLanguage = useUIStore(s => s.targetLanguage || 'english');
  const setTargetLanguage = useUIStore(s => s.setTargetLanguage);

  const videoFile = useVideoStore(s => s.file);
  const videoFilePath = useVideoStore(s => s.path);
  const originalVideoPath = useVideoStore(s => s.originalPath);
  const dubbedVideoPath = useVideoStore(s => s.dubbedVideoPath);
  const activeTrack = useVideoStore(s => s.activeTrack);
  const hasDubbedTrack = useVideoStore(s => !!s.dubbedUrl);
  const setActiveTrack = useVideoStore(s => s.setActiveTrack);
  const meta = useVideoStore(s => s.meta);
  const dubVoice = useUIStore(s => s.dubVoice);
  // no local modal state; handled globally

  const {
    durationSecs: metadataDurationSecs,
    hoursNeeded: metadataHoursNeeded,
    metadataStatus,
    metadataErrorCode,
    metadataErrorMessage,
    isMetadataPending,
  } = useVideoMetadata(videoFilePath ?? null);

  const metadataStatusMessage =
    metadataErrorCode === 'icloud-placeholder'
      ? t(
          'generateSubtitles.validation.icloudPlaceholder',
          'This file is stored in iCloud. In Finder, click “Download” and wait for the cloud icon to finish, then try again.'
        )
      : isMetadataPending
        ? t(
            'generateSubtitles.validation.processingDuration',
            'Video duration is being processed. Please try again shortly.'
          )
        : metadataStatus === 'failed' && metadataErrorMessage
          ? metadataErrorMessage
          : null;

  const derivedDurationSecs =
    metadataDurationSecs ??
    (typeof meta?.duration === 'number' ? meta.duration : null);
  const derivedHoursNeeded =
    metadataHoursNeeded ??
    (derivedDurationSecs != null ? derivedDurationSecs / 3600 : null);

  const isTranscribeDisabled =
    isTranscribing ||
    derivedHoursNeeded == null ||
    isMetadataPending ||
    isMerging ||
    translationInProgress;

  const hasUntranslated = hasSubs
    ? order.some(id => {
        const seg = segments[id];
        return (seg.original || '').trim() && !(seg.translation || '').trim();
      })
    : false;
  const canSaveOriginalVideo = isManagedTempOriginalVideoPath(originalVideoPath);
  const canSaveDubbedVideo = Boolean(dubbedVideoPath);
  const showTranscribeButton = !transcriptionIsCompleted && !translationInProgress;
  const showPreserveActions = canSaveOriginalVideo || canSaveDubbedVideo;
  const showProcessingActions = showTranscribeButton || showPreserveActions;
  const showDubAction = activeTrack !== 'dubbed';

  async function handleTranslateAll() {
    try {
      logButton('translate_full');
      await runFullSrtTranslation();
    } catch (err) {
      console.error('[SideMenu] translate error:', err);
      setTranslation({
        stage: t('generateSubtitles.status.error', 'Error'),
        percent: 100,
        inProgress: false,
      });
    }
  }

  async function handleMountOrChangeSrt() {
    logButton('mount_or_change_srt');
    const res = await openSubtitleWithElectron();
    if (res?.segments) {
      const associatedVideoPath = originalVideoPath ?? videoFilePath ?? null;
      // SRT loaded from disk; mark origin accordingly
      useSubStore
        .getState()
        .load(
          res.segments,
          res.filePath ?? null,
          'disk',
          associatedVideoPath
        );
      // Reset transcription completion state so Generate panel doesn't show stale 'Transcription Complete'
      try {
        useTaskStore.getState().setTranscription({
          isCompleted: false,
          inProgress: false,
          id: null,
          stage: '',
          percent: 0,
        });
      } catch {
        // Do nothing
      }
      logVideo('srt_loaded', { path: res.filePath ?? '' });
      // Ensure the Edit Subtitles panel is visible so users immediately see loaded SRT
      try {
        useUIStore.getState().setEditPanelOpen(true);
      } catch {
        // Do nothing
      }
      // Optionally scroll to current cue for immediate context
      try {
        useSubStore.getState().scrollToCurrent();
      } catch {
        // Do nothing
      }
    }
    if (res?.error) {
      logError('srt_load', res.error);
    }
  }
  async function handleTranscribe() {
    const operationId = `transcribe-${Date.now()}`;
    await startTranscriptionFlow({
      videoFile: (videoFile as any) ?? null,
      videoFilePath: videoFilePath ?? null,
      durationSecs: derivedDurationSecs,
      hoursNeeded: derivedHoursNeeded,
      operationId,
      metadataStatus: {
        status: metadataStatus,
        code: metadataErrorCode,
        message: metadataErrorMessage,
      },
    });
  }

  async function handleSaveOriginalVideo() {
    logButton('save_original_video');
    await saveOriginalVideoFile(originalVideoPath);
  }

  async function handleSaveDubbedVideo() {
    logButton('save_dubbed_video');
    await saveDubbedVideoFile({
      dubbedVideoPath,
      sourceVideoPath: originalVideoPath ?? videoFilePath,
      dubVoice,
    });
  }

  async function handleDub() {
    const subtitleState = useSubStore.getState();
    const currentSegments = subtitleState.order.map(id => subtitleState.segments[id]);
    if (currentSegments.length === 0) {
      return;
    }

    const operationId = `dub-${Date.now()}`;
    const videoStoreState = useVideoStore.getState();
    const sourceVideoPath =
      videoStoreState.originalPath ??
      subtitleState.sourceVideoPath ??
      videoFilePath ??
      videoStoreState.path;

    await executeDubGeneration({
      segments: currentSegments,
      operationId,
      videoPath: sourceVideoPath,
      voice: dubVoice,
      targetLanguage,
      videoDurationSeconds: derivedDurationSecs ?? undefined,
    });
  }

  function resetSubtitleWorkflowState() {
    useTaskStore.getState().setTranscription({
      id: null,
      stage: '',
      percent: 0,
      inProgress: false,
      isCompleted: false,
    });
    useTaskStore.getState().setTranslation({
      id: null,
      stage: '',
      percent: 0,
      inProgress: false,
      isCompleted: false,
    });
  }

  async function handleUnmountSubtitles() {
    if (hasSubs) {
      const choice = await openUnsavedSrtConfirm();
      if (choice === 'cancel') {
        return;
      }
      if (choice === 'save') {
        const saved = await saveCurrentSubtitles();
        if (!saved) {
          return;
        }
      }
    }
    unmountCurrentSubtitles();
    resetSubtitleWorkflowState();
  }

  async function handleDeleteStoredSubtitles() {
    try {
      const removed = await deleteMountedStoredSubtitle();
      if (removed) {
        resetSubtitleWorkflowState();
      }
    } catch (err) {
      console.error('[SideMenu] Failed to delete stored subtitles:', err);
    }
  }

  // Hide completely in fullscreen mode
  if (isFullScreen) return null;
  // Render as a dedicated column next to the video (grid area); not overlayed
  return (
    <>
      <div
        className={sidePanelShellStyles}
        aria-label={t('videoPlayer.sideActions', 'Video side actions')}
      >
        <div className={sidePanelSectionStyles}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              logButton('change_video');
              openChangeVideo();
            }}
            title={t('videoPlayer.changeVideo', 'Change Video')}
            disabled={isTranscribing || translationInProgress || isMerging}
          >
            <span className={sidePanelButtonContentStyles}>
              <Video size={15} strokeWidth={2.2} />
              {t('videoPlayer.changeVideo', 'Change Video')}
            </span>
          </Button>

          {hasDubbedTrack && (
            <Button
              size="sm"
              variant={activeTrack === 'dubbed' ? 'primary' : 'secondary'}
              onClick={async () => {
                try {
                  await setActiveTrack(
                    activeTrack === 'dubbed' ? 'original' : 'dubbed'
                  );
                } catch (err) {
                  console.error('[SideMenu] Failed to switch audio track:', err);
                }
              }}
              title={
                activeTrack === 'dubbed'
                  ? t('videoPlayer.useOriginalAudio', 'Use Original Audio')
                  : t('videoPlayer.useDubbedAudio', 'Use Dubbed Audio')
              }
            >
              <span className={sidePanelButtonContentStyles}>
                <AudioLines size={15} strokeWidth={2.2} />
                {activeTrack === 'dubbed'
                  ? t('videoPlayer.useOriginalAudio', 'Use Original Audio')
                  : t('videoPlayer.useDubbedAudio', 'Use Dubbed Audio')}
              </span>
            </Button>
          )}

          <div className={sidePanelButtonWithIconsRowStyles}>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleMountOrChangeSrt}
              disabled={isTranscribing || translationInProgress || isMerging}
              title={
                originalSrtPath
                  ? t('videoPlayer.changeSrt', 'Change SRT')
                  : t('videoPlayer.mountSrt', 'Mount SRT')
              }
            >
              <span className={sidePanelButtonContentStyles}>
                <FileText size={15} strokeWidth={2.2} />
                {originalSrtPath
                  ? t('videoPlayer.changeSrt', 'Change SRT')
                  : t('videoPlayer.mountSrt', 'Mount SRT')}
              </span>
            </Button>
            {hasSubs ? (
              <IconButton
                size="sm"
                variant="secondary"
                icon={<X size={15} strokeWidth={2.2} />}
                title={t('common.close', 'Close')}
                aria-label={t('common.close', 'Close')}
                onClick={handleUnmountSubtitles}
                disabled={isTranscribing || translationInProgress || isMerging}
              />
            ) : null}
            {hasSubs && libraryEntryId ? (
              <IconButton
                size="sm"
                variant="secondary"
                icon={<Trash2 size={15} strokeWidth={2.2} />}
                title={t('common.delete', 'Delete')}
                aria-label={t('common.delete', 'Delete')}
                onClick={handleDeleteStoredSubtitles}
                disabled={isTranscribing || translationInProgress || isMerging}
              />
            ) : null}
          </div>

          {hasSubs && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => scrollToCurrent()}
              title={t(
                'videoPlayer.scrollToCurrentSubtitle',
                'Scroll to current subtitle'
              )}
            >
              <span className={sidePanelButtonContentStyles}>
                <LocateFixed size={15} strokeWidth={2.2} />
                {t(
                  'videoPlayer.scrollToCurrentSubtitle',
                  'Scroll to current subtitle'
                )}
              </span>
            </Button>
          )}
        </div>

        {showProcessingActions && <div className={sidePanelDividerStyles} />}

        {showProcessingActions && (
          <div className={sidePanelSectionStyles}>
            {showTranscribeButton && (
              <Button
                size="sm"
                variant="primary"
                onClick={handleTranscribe}
                isLoading={isTranscribing}
                disabled={isTranscribeDisabled}
                title={metadataStatusMessage ?? t('input.transcribeOnly')}
              >
                <span className={sidePanelButtonContentStyles}>
                  {!isTranscribing ? <Mic size={15} strokeWidth={2.2} /> : null}
                  {isTranscribing
                    ? t('subtitles.generating')
                    : t('input.transcribeOnly')}
                </span>
              </Button>
            )}
            {showTranscribeButton &&
              metadataStatusMessage &&
              metadataErrorCode !== 'icloud-placeholder' &&
              !isTranscribing && (
              <div className={sidePanelWarningStyles} role="alert">
                <div className={sidePanelWarningIconStyles} aria-hidden="true">
                  <CircleAlert size={12} strokeWidth={2.2} />
                </div>
                <div className={sidePanelWarningTextStyles}>
                  {metadataStatusMessage}
                </div>
              </div>
            )}

            {canSaveOriginalVideo && (
              <Button
                size="sm"
                variant="warning"
                onClick={handleSaveOriginalVideo}
                title={originalVideoPath ?? t('input.saveOriginalVideo')}
              >
                <span className={sidePanelButtonContentStyles}>
                  <Download size={15} strokeWidth={2.2} />
                  {t('input.saveOriginalVideo')}
                </span>
              </Button>
            )}

            {canSaveDubbedVideo && (
              <Button
                size="sm"
                variant="success"
                onClick={handleSaveDubbedVideo}
                disabled={isDubbing}
                title={dubbedVideoPath ?? t('input.saveDubbedVideo')}
              >
                <span className={sidePanelButtonContentStyles}>
                  <Save size={15} strokeWidth={2.2} />
                  {t('input.saveDubbedVideo')}
                </span>
              </Button>
            )}
          </div>
        )}

        {hasUntranslated && (
          <div className={sidePanelSectionStyles}>
            <div className={sidePanelFieldStackStyles}>
              <div className={sidePanelLabelStyles}>
                {t('subtitles.outputLanguage', 'Output language')}
              </div>
              <select
                className={sidePanelSelectStyles}
                value={targetLanguage}
                onChange={e => setTargetLanguage(e.target.value)}
              >
                {TRANSLATION_LANGUAGES_BASE.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
                {TRANSLATION_LANGUAGE_GROUPS.map(group => (
                  <optgroup key={group.labelKey} label={t(group.labelKey)}>
                    {group.options.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {t(opt.labelKey)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div
              className={
                showDubAction ? sidePanelButtonRowStyles : sidePanelFieldStackStyles
              }
            >
              <Button
                size="sm"
                variant="primary"
                onClick={handleTranslateAll}
                disabled={isTranscribing || translationInProgress || isMerging}
                title={t('subtitles.translate', 'Translate')}
              >
                <span className={sidePanelButtonContentStyles}>
                  <Languages size={15} strokeWidth={2.2} />
                  {t('subtitles.translate', 'Translate')}
                </span>
              </Button>
              {showDubAction ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleDub}
                  disabled={isDubbing || isTranscribing || translationInProgress || isMerging}
                  isLoading={isDubbing}
                  title={t('subtitles.dub', 'Dub Voice')}
                >
                  <span className={sidePanelButtonContentStyles}>
                    {!isDubbing ? <AudioLines size={15} strokeWidth={2.2} /> : null}
                    {t('subtitles.dub', 'Dub Voice')}
                  </span>
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

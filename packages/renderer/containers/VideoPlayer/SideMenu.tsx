import { css } from '@emotion/css';
import Button from '../../components/Button';
import { colors, selectStyles } from '../../styles';
import {
  useSubStore,
  useTaskStore,
  useUIStore,
  useVideoStore,
} from '../../state';
import { openChangeVideo } from '../../state/modal-store';
import { logButton, logVideo, logError } from '../../utils/logger';
import { useTranslation } from 'react-i18next';
import { openSubtitleWithElectron } from '../../../shared/helpers';
import {
  TRANSLATION_LANGUAGES_BASE,
  TRANSLATION_LANGUAGE_GROUPS,
} from '../../constants/translation-languages';
import { translateMissingUntranslated } from '../../utils/translateMissing';
import { startTranscriptionFlow } from '../GenerateSubtitles/utils/subtitleGeneration';

export default function SideMenu({
  isFullScreen = false,
}: {
  isFullScreen?: boolean;
}) {
  const { t } = useTranslation();
  const hasSubs = useSubStore(s => s.order.length > 0);
  const { order, segments, originalPath, scrollToCurrent } = useSubStore(s => ({
    order: s.order,
    segments: s.segments,
    originalPath: s.originalPath,
    scrollToCurrent: s.scrollToCurrent,
  }));
  const setTranslation = useTaskStore(s => s.setTranslation);
  const isTranscribing = useTaskStore(s => !!s.transcription.inProgress);
  const isMerging = useTaskStore(s => !!s.merge.inProgress);
  const transcriptionIsCompleted = useTaskStore(
    s => !!s.transcription.isCompleted
  );
  const translationInProgress = useTaskStore(s => !!s.translation.inProgress);
  const targetLanguage = useUIStore(s => s.targetLanguage || 'english');
  const setTargetLanguage = useUIStore(s => s.setTargetLanguage);

  const videoFile = useVideoStore(s => s.file);
  const videoFilePath = useVideoStore(s => s.path);
  const meta = useVideoStore(s => s.meta);
  // no local modal state; handled globally

  const hasUntranslated = hasSubs
    ? order.some(id => {
        const seg = segments[id];
        return (seg.original || '').trim() && !(seg.translation || '').trim();
      })
    : false;

  async function handleTranslateMissing() {
    try {
      await translateMissingUntranslated();
    } catch (err) {
      console.error('[SideMenu] translate missing error:', err);
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
      useSubStore.getState().load(res.segments, res.filePath ?? null);
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
    const durationSecs = meta?.duration ?? null;
    const hoursNeeded = durationSecs != null ? durationSecs / 3600 : null;
    await startTranscriptionFlow({
      videoFile: (videoFile as any) ?? null,
      videoFilePath: videoFilePath ?? null,
      durationSecs,
      hoursNeeded,
      operationId,
    });
  }

  // Hide completely in fullscreen mode
  if (isFullScreen) return null;
  // Render as a dedicated column next to the video (grid area); not overlayed
  return (
    <>
      <div
        className={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-end; /* anchor items to bottom when there's space */
          gap: 8px;
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid ${colors.border};
          border-radius: 6px;
          padding: 8px 8px;
          backdrop-filter: blur(4px);
          height: 100%;
          overflow: auto;
        `}
        aria-label="Video side actions"
      >
        {/* Spacer pushes actions toward the bottom when there is vertical room */}
        <div
          className={css`
            flex: 1 1 auto;
          `}
        />
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
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: 8 }}
          >
            <rect x="3" y="5" width="18" height="14" rx="2" ry="2" />
            <path d="M7 9l5 3-5 3z" />
          </svg>
          {t('videoPlayer.changeVideo', 'Change Video')}
        </Button>

        <Button
          size="sm"
          variant="secondary"
          onClick={handleMountOrChangeSrt}
          disabled={isTranscribing || translationInProgress || isMerging}
          title={
            originalPath
              ? t('videoPlayer.changeSrt', 'Change SRT')
              : t('videoPlayer.mountSrt', 'Mount SRT')
          }
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: 8 }}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          {originalPath
            ? t('videoPlayer.changeSrt', 'Change SRT')
            : t('videoPlayer.mountSrt', 'Mount SRT')}
        </Button>

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
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: 8 }}
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19 12a7 7 0 0 1-7 7" />
              <path d="M12 5a 7 7 0 0 1 7 7" />
              <path d="M5 12a7 7 0 0 1 7-7" />
              <path d="M12 19a7 7 0 0 1-7-7" />
            </svg>
            {t(
              'videoPlayer.scrollToCurrentSubtitle',
              'Scroll to current subtitle'
            )}
          </Button>
        )}

        {/* Transcribe appears only when Generate panel shows it: not completed and not translating */}
        {!transcriptionIsCompleted && !translationInProgress && (
          <Button
            size="sm"
            variant="primary"
            onClick={handleTranscribe}
            isLoading={isTranscribing}
            title={t('input.transcribeOnly')}
          >
            {isTranscribing
              ? t('subtitles.generating')
              : t('input.transcribeOnly')}
          </Button>
        )}

        {hasUntranslated && (
          <div
            className={css`
              display: flex;
              flex-direction: column;
              gap: 6px;
              margin-top: 10px;
            `}
          >
            <select
              className={selectStyles}
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

            <Button
              size="sm"
              variant="primary"
              onClick={handleTranslateMissing}
              disabled={isTranscribing || translationInProgress}
              title={t('subtitles.translate', 'Translate')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginRight: 8 }}
              >
                <path d="M4 7h16" />
                <path d="M9 7c0 7 6 7 6 14" />
                <path d="M12 20l4-4" />
                <path d="M20 20l-4-4" />
              </svg>
              {t('subtitles.translate', 'Translate')}
            </Button>
          </div>
        )}
        <div
          className={css`
            height: 2px;
          `}
        />
      </div>
    </>
  );
}

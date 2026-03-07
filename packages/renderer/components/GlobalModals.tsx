import ConfirmReplaceSrtDialog from '../containers/GenerateSubtitles/components/ConfirmReplaceSrtDialog';
import CreditRanOutDialog from '../containers/GenerateSubtitles/components/CreditRanOutDialog';
import ApiKeysRequiredDialog from './ApiKeysRequiredDialog';
import {
  useModalStore,
  resolveUnsavedSrt,
  resolveCreditRanOut,
  closeChangeVideo,
  closeLogs,
  closeApiKeysRequired,
  closeUpdateNotes,
} from '../state/modal-store';
import { useUIStore } from '../state/ui-store';
import MediaInputSection from '../containers/GenerateSubtitles/components/MediaInputSection';
import VideoSuggestionPanel from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/index.js';
import { useUrlStore } from '../state/url-store';
import { useVideoStore, useTaskStore, useUpdateStore } from '../state';
import { css } from '@emotion/css';
import { colors } from '../styles';
import { useEffect, useRef } from 'react';
import LogsModal from './LogsModal';
import Modal from './Modal';
import Button from './Button';
import { useTranslation } from 'react-i18next';
import * as UpdateIPC from '../ipc/update';

const updateNotesDetailsStyles = css`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const updateNotesDateStyles = css`
  color: ${colors.textDim};
  font-size: 0.9rem;
`;

const updateNotesBodyStyles = css`
  max-height: min(55vh, 420px);
  overflow-y: auto;
  white-space: pre-wrap;
  line-height: 1.5;
`;

const changeVideoContentStyles = css`
  width: min(820px, 94vw);
  max-height: 88vh;
`;

const changeVideoBodyStyles = css`
  margin: 0;
  overflow-y: auto;
`;

const changeVideoAiContentStyles = css`
  width: min(1240px, 96vw);
  max-height: 92vh;
`;

const changeVideoAiBodyStyles = css`
  margin: 0;
  overflow: hidden;
`;

const changeVideoFooterStyles = css`
  margin-top: 16px;
`;

const changeVideoAiHeaderStyles = css`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
`;

export default function GlobalModals() {
  const { t } = useTranslation();
  const unsavedOpen = useModalStore(s => s.unsavedSrtOpen);
  const creditOpen = useModalStore(s => s.creditRanOutOpen);
  const changeVideoOpen = useModalStore(s => s.changeVideoOpen);
  const changeVideoMode = useModalStore(s => s.changeVideoMode);
  const setChangeVideoMode = useModalStore(s => s.setChangeVideoMode);
  const logsOpen = useModalStore(s => s.logsOpen);
  const logsReportPrompt = useModalStore(s => s.logsReportPrompt);
  const apiKeysRequiredOpen = useModalStore(s => s.apiKeysRequiredOpen);
  const updateNotesOpen = useModalStore(s => s.updateNotesOpen);
  const updateNotes = useModalStore(s => s.updateNotes);
  const requiredUpdateOpen = useModalStore(s => s.requiredUpdateOpen);
  const requiredUpdate = useModalStore(s => s.requiredUpdate);
  const toggleSettings = useUIStore(s => s.toggleSettings);
  const updateAvailable = useUpdateStore(s => s.available);
  const updateDownloading = useUpdateStore(s => s.downloading);
  const updateDownloaded = useUpdateStore(s => s.downloaded);
  const updateError = useUpdateStore(s => s.error);
  const checkForUpdates = useUpdateStore(s => s.check);
  const installUpdate = useUpdateStore(s => s.install);
  const formattedReleaseDate = (() => {
    const raw = updateNotes?.releaseDate;
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? raw : new Date(parsed).toLocaleDateString();
  })();

  // Reuse existing stores for MediaInputSection
  const urlInput = useUrlStore(s => s.urlInput);
  const setUrlInput = useUrlStore(s => s.setUrlInput);
  const downloadQuality = useUrlStore(s => s.downloadQuality);
  const setDownloadQuality = useUrlStore(s => s.setDownloadQuality);
  const download = useUrlStore(s => s.download);
  const downloadMedia = useUrlStore(s => s.downloadMedia);
  const isTranslationInProgress = useTaskStore(s => s.translation.inProgress);
  const recentLocalMedia = useVideoStore(s => s.recentLocalMedia);
  const openLocalMedia = useVideoStore(s => s.openLocalMedia);
  const openRecentLocalMedia = useVideoStore(s => s.openRecentLocalMedia);
  const refreshRecentLocalMedia = useVideoStore(s => s.refreshRecentLocalMedia);
  const mountFilePreserveSubs = useVideoStore(s => s.mountFilePreserveSubs);
  const videoPath = useVideoStore(s => s.path);
  const videoFile = useVideoStore(s => s.file);

  // Close change-video modal once a new video mounts (path or file changes)
  const initialRef = useRef<{ path: string | null; hasFile: boolean } | null>(
    null
  );
  useEffect(() => {
    if (changeVideoOpen && !initialRef.current) {
      initialRef.current = { path: videoPath ?? null, hasFile: !!videoFile };
    }
    if (changeVideoOpen && initialRef.current) {
      const changed =
        (videoPath && videoPath !== initialRef.current.path) ||
        (!!videoFile && !initialRef.current.hasFile);
      if (changed) {
        closeChangeVideo();
        initialRef.current = null;
      }
    }
    if (!changeVideoOpen) {
      initialRef.current = null;
    }
  }, [changeVideoOpen, videoPath, videoFile]);

  useEffect(() => {
    if (!changeVideoOpen) return;
    void refreshRecentLocalMedia();
  }, [changeVideoOpen, refreshRecentLocalMedia]);

  const handleRequiredUpdateAction = async () => {
    if (updateDownloaded) {
      await installUpdate();
      return;
    }

    try {
      if (updateAvailable && !updateDownloading) {
        await useUpdateStore.getState().download();
        return;
      }

      await checkForUpdates();
    } catch (err) {
      console.warn('[GlobalModals] Required update action failed:', err);
      if (requiredUpdate?.downloadUrl) {
        await window.appShell.openExternal(requiredUpdate.downloadUrl);
      }
    }
  };

  const handleCloseUpdateNotes = async () => {
    const version = updateNotes?.version;
    closeUpdateNotes();
    try {
      await UpdateIPC.clearPostInstallNotice(version);
    } catch (err) {
      console.warn('[GlobalModals] Failed to clear post-install notes:', err);
    }
  };

  return (
    <>
      <ConfirmReplaceSrtDialog
        open={unsavedOpen}
        onCancel={() => resolveUnsavedSrt('cancel')}
        onDiscardAndTranscribe={() => resolveUnsavedSrt('discard')}
        onSaveAndTranscribe={() => resolveUnsavedSrt('save')}
      />
      <CreditRanOutDialog
        open={creditOpen}
        onOk={() => resolveCreditRanOut('ok')}
        onOpenSettings={() => {
          resolveCreditRanOut('settings');
          toggleSettings(true);
        }}
      />
      <Modal
        open={changeVideoOpen}
        title={
          changeVideoMode === 'ai'
            ? t('videoPlayer.findVideoWithAi', 'Find Video With AI')
            : t('videoPlayer.changeVideo', 'Change Video')
        }
        titleId="change-video-title"
        onClose={() => closeChangeVideo()}
        contentClassName={
          changeVideoMode === 'ai'
            ? changeVideoAiContentStyles
            : changeVideoContentStyles
        }
        bodyClassName={
          changeVideoMode === 'ai'
            ? changeVideoAiBodyStyles
            : changeVideoBodyStyles
        }
      >
        {changeVideoMode === 'ai' ? (
          <>
            <div className={changeVideoAiHeaderStyles}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setChangeVideoMode('source')}
              >
                {t('common.back', 'Back')}
              </Button>
            </div>
            <VideoSuggestionPanel
              disabled={isTranslationInProgress || download.inProgress}
              hideToggle
              initialOpen
              isDownloadInProgress={download.inProgress}
              localPrimaryActionLabel={t(
                'videoPlayer.useDownloadedVideo',
                'Use this video'
              )}
              onDownload={item =>
                downloadMedia({
                  preserveSubtitles: true,
                  url: item.url,
                })
              }
              onOpenDownloadedVideo={async item => {
                const filePath = String(item.localPath || '').trim();
                if (!filePath) return;
                const fallbackName =
                  filePath.split(/[\\/]/).pop() || item.title || 'video';
                await mountFilePreserveSubs({
                  name: fallbackName,
                  path: filePath,
                });
                useUIStore.getState().setInputMode('file');
                closeChangeVideo();
              }}
              primaryActionLabel={t(
                'videoPlayer.useThisVideo',
                'Use this video'
              )}
            />
          </>
        ) : (
          <>
            <MediaInputSection
              videoFile={null}
              recentMedia={recentLocalMedia}
              onOpenFileDialog={async () => {
                const res = await openLocalMedia({ preserveSubtitles: true });
                if (!res.canceled) closeChangeVideo();
                return res;
              }}
              onOpenRecentFile={async path => {
                const res = await openRecentLocalMedia(path, {
                  preserveSubtitles: true,
                });
                if (res.opened) closeChangeVideo();
              }}
              isDownloadInProgress={download.inProgress}
              isTranslationInProgress={isTranslationInProgress}
              urlInput={urlInput}
              setUrlInput={setUrlInput}
              downloadQuality={downloadQuality}
              setDownloadQuality={setDownloadQuality}
              handleProcessUrl={async () => {
                await downloadMedia({ preserveSubtitles: true });
              }}
            />
            <div className={changeVideoFooterStyles}>
              <Button
                variant="secondary"
                onClick={() => setChangeVideoMode('ai')}
                fullWidth
                disabled={isTranslationInProgress || download.inProgress}
              >
                {t('videoPlayer.findVideoWithAi', 'Find Video With AI')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <LogsModal
        open={logsOpen}
        reportPrompt={logsReportPrompt}
        onClose={() => closeLogs()}
      />
      <Modal
        open={updateNotesOpen}
        title={
          updateNotes?.releaseName?.trim() ||
          (updateNotes?.version
            ? t('common.whatsNewVersionTitle', "What's New in v{{version}}", {
                version: updateNotes.version,
              })
            : t('common.whatsNewTitle', "What's New"))
        }
        onClose={() => void handleCloseUpdateNotes()}
        actions={
          <Button
            variant="primary"
            onClick={() => void handleCloseUpdateNotes()}
          >
            {t('common.gotIt', 'Got it')}
          </Button>
        }
      >
        <div className={updateNotesDetailsStyles}>
          {formattedReleaseDate && (
            <div className={updateNotesDateStyles}>{formattedReleaseDate}</div>
          )}
          <div className={updateNotesBodyStyles}>
            {updateNotes?.notes ?? ''}
          </div>
        </div>
      </Modal>
      <ApiKeysRequiredDialog
        open={apiKeysRequiredOpen}
        onClose={() => closeApiKeysRequired()}
      />
      <Modal
        open={requiredUpdateOpen}
        title={t('common.updateRequiredTitle', 'Update Required')}
        titleId="required-update-title"
        actions={
          <>
            {requiredUpdate?.downloadUrl && (
              <Button
                variant="secondary"
                onClick={() =>
                  window.appShell.openExternal(requiredUpdate.downloadUrl!)
                }
              >
                {t('common.openDownloadPage', 'Open Download Page')}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => void handleRequiredUpdateAction()}
              disabled={updateDownloading}
              isLoading={updateDownloading}
            >
              {updateDownloaded
                ? t('common.installUpdateNow', 'Install Update')
                : updateAvailable
                  ? t('common.downloadUpdateNow', 'Download Update')
                  : t('common.checkForUpdateNow', 'Check for Update')}
            </Button>
          </>
        }
        hideCloseButton
      >
        <div className={updateNotesDetailsStyles}>
          <div>
            {requiredUpdate?.message ||
              t(
                'common.updateRequiredBody',
                'This version of Translator is no longer supported by the backend. Update the app to continue.'
              )}
          </div>
          {requiredUpdate?.minVersion && (
            <div className={updateNotesDateStyles}>
              {t('common.minimumVersionLabel', 'Minimum supported version')}: v
              {requiredUpdate.minVersion}
            </div>
          )}
          {requiredUpdate?.clientVersion && (
            <div className={updateNotesDateStyles}>
              {t('common.currentVersionLabel', 'Current version')}: v
              {requiredUpdate.clientVersion}
            </div>
          )}
          {updateError && (
            <div className={updateNotesDateStyles}>{String(updateError)}</div>
          )}
        </div>
      </Modal>
    </>
  );
}

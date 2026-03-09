import ConfirmReplaceSrtDialog from '../containers/GenerateSubtitles/components/ConfirmReplaceSrtDialog';
import CreditRanOutDialog from '../containers/GenerateSubtitles/components/CreditRanOutDialog';
import ApiKeysRequiredDialog from './ApiKeysRequiredDialog';
import {
  useModalStore,
  resolveDownloadSwitch,
  resolveUnsavedSrt,
  resolveCreditRanOut,
  closeChangeVideo,
  closeLogs,
  closeApiKeysRequired,
  closeUpdateNotes,
} from '../state/modal-store';
import { useUIStore } from '../state/ui-store';
import MediaInputSection from '../containers/GenerateSubtitles/components/MediaInputSection';
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

export default function GlobalModals() {
  const { t } = useTranslation();
  const unsavedOpen = useModalStore(s => s.unsavedSrtOpen);
  const downloadSwitchOpen = useModalStore(s => s.downloadSwitchOpen);
  const creditOpen = useModalStore(s => s.creditRanOutOpen);
  const changeVideoOpen = useModalStore(s => s.changeVideoOpen);
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
      <Modal
        open={downloadSwitchOpen}
        title={t(
          'input.downloadFinishedSwitchTitle',
          'Watch downloaded video?'
        )}
        titleId="download-switch-title"
        onClose={() => resolveDownloadSwitch(false)}
        hideCloseButton
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => resolveDownloadSwitch(false)}
            >
              {t('input.downloadFinishedWatchLater', 'Watch later')}
            </Button>
            <Button
              variant="primary"
              onClick={() => resolveDownloadSwitch(true)}
            >
              {t('input.downloadFinishedWatchNow', 'Watch now')}
            </Button>
          </>
        }
      >
        <div>
          {t(
            'input.downloadFinishedSwitchPrompt',
            'Your download is ready. Watch it now, or keep your current video and open it later from history.'
          )}
        </div>
      </Modal>
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
        title={t('videoPlayer.changeVideo', 'Change Video')}
        titleId="change-video-title"
        onClose={() => closeChangeVideo()}
        contentClassName={changeVideoContentStyles}
        bodyClassName={changeVideoBodyStyles}
      >
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

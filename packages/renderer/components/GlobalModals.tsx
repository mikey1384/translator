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
import { useEffect, useRef, useState } from 'react';
import { useSubStore } from '../state/subtitle-store';
import { useWorkspaceBusy } from './workspace/WorkspaceActions';
import LogsModal from './LogsModal';
import LongDownloadConfirmDialog from './LongDownloadConfirmDialog';
import UrlCookieBanner from '../containers/GenerateSubtitles/UrlCookieBanner';
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

const keepSubtitlesStyles = css`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 12px;
  color: ${colors.textDim};
  line-height: 1.4;
  cursor: pointer;
  /* Same toggle as the workspace "Edit subtitles" switch, not a native box. */
  input {
    appearance: none;
    flex: none;
    position: relative;
    width: 38px;
    height: 22px;
    margin: 0;
    border-radius: 11px;
    background: ${colors.grayMedium};
    cursor: pointer;
    transition: background 0.15s ease;
  }
  input::after {
    content: '';
    position: absolute;
    top: 3px;
    inset-inline-start: 3px;
    width: 16px;
    height: 16px;
    border-radius: 8px;
    background: ${colors.text};
    transition: transform 0.15s ease;
  }
  input:checked {
    background: ${colors.primary};
  }
  input:checked::after {
    transform: translateX(16px);
    background: ${colors.onPrimary};
  }
  [dir='rtl'] & input:checked::after {
    transform: translateX(-16px);
  }
  span {
    padding-top: 1px;
  }
  input:focus-visible {
    outline: 2px solid ${colors.primary};
    outline-offset: 2px;
  }
`;

const noticeMessageStyles = css`
  white-space: pre-line;
  line-height: 1.5;
`;

export default function GlobalModals() {
  const { t, i18n } = useTranslation();
  const isEnglishUi = /^en\b/i.test(i18n.language || 'en');
  const unsavedOpen = useModalStore(s => s.unsavedSrtOpen);
  const unsavedContext = useModalStore(s => s.unsavedSrtContext);
  const downloadSwitchOpen = useModalStore(s => s.downloadSwitchOpen);
  const downloadSwitchContext = useModalStore(s => s.downloadSwitchContext);
  const creditOpen = useModalStore(s => s.creditRanOutOpen);
  const changeVideoOpen = useModalStore(s => s.changeVideoOpen);
  const logsOpen = useModalStore(s => s.logsOpen);
  const logsReportPrompt = useModalStore(s => s.logsReportPrompt);
  const apiKeysRequiredOpen = useModalStore(s => s.apiKeysRequiredOpen);
  const updateNotesOpen = useModalStore(s => s.updateNotesOpen);
  const updateNotes = useModalStore(s => s.updateNotes);
  const requiredUpdateOpen = useModalStore(s => s.requiredUpdateOpen);
  const requiredUpdate = useModalStore(s => s.requiredUpdate);
  const notice = useModalStore(s => s.notice);
  const resolveNotice = useModalStore(s => s.resolveNotice);
  const toggleSettings = useUIStore(s => s.toggleSettings);
  const updateAvailable = useUpdateStore(s => s.available);
  const updateDownloading = useUpdateStore(s => s.downloading);
  const updateDownloaded = useUpdateStore(s => s.downloaded);
  const updateInstalling = useUpdateStore(s => s.installing);
  const updateCheckStatus = useUpdateStore(s => s.checkStatus);
  const checkForUpdates = useUpdateStore(s => s.check);
  const installUpdate = useUpdateStore(s => s.install);
  const formattedReleaseDate = (() => {
    const raw = updateNotes?.releaseDate;
    if (!raw) return null;
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) return null;
    try {
      return new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'long',
      }).format(new Date(parsed));
    } catch {
      return new Date(parsed).toLocaleDateString();
    }
  })();

  // Reuse existing stores for MediaInputSection
  const urlInput = useUrlStore(s => s.urlInput);
  const setUrlInput = useUrlStore(s => s.setUrlInput);
  const downloadQuality = useUrlStore(s => s.downloadQuality);
  const setDownloadQuality = useUrlStore(s => s.setDownloadQuality);
  const download = useUrlStore(s => s.download);
  const downloadMedia = useUrlStore(s => s.downloadMedia);
  const isTranslationInProgress = useTaskStore(s => s.translation.inProgress);
  // Any running job (transcription, dubbing, export…) blocks swapping the
  // source, not only translation.
  const workspaceBusy = useWorkspaceBusy();
  const hasMountedSubtitles = useSubStore(s => s.order.length > 0);
  // A different video starts without the current subtitles; keeping them is
  // an explicit choice for another copy of the same video. Reset on every open.
  const [keepSubtitles, setKeepSubtitles] = useState(false);
  useEffect(() => {
    if (changeVideoOpen) setKeepSubtitles(false);
  }, [changeVideoOpen]);
  const preserveSubtitles = hasMountedSubtitles && keepSubtitles;
  const recentLocalMedia = useVideoStore(s => s.recentLocalMedia);
  const openLocalMedia = useVideoStore(s => s.openLocalMedia);
  const openRecentLocalMedia = useVideoStore(s => s.openRecentLocalMedia);
  const removeRecentLocalMedia = useVideoStore(s => s.removeRecentLocalMedia);
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
    if (updateInstalling) return;

    if (updateDownloaded) {
      await installUpdate();
      return;
    }

    const openDownloadPage = async () => {
      if (requiredUpdate?.downloadUrl) {
        await window.appShell.openExternal(requiredUpdate.downloadUrl);
      }
    };

    if (updateAvailable && !updateDownloading) {
      await useUpdateStore.getState().download();
      if (useUpdateStore.getState().error && !updateDownloaded) {
        await openDownloadPage();
      }
      return;
    }

    // The updater swallows its own errors, so decide from the result: when
    // it finds nothing (feed unreachable, or the Windows release lags), send
    // the user to the download page instead of leaving a dead button.
    const status = await checkForUpdates();
    if (status !== 'available') {
      await openDownloadPage();
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
        context={unsavedContext}
        onCancel={() => resolveUnsavedSrt('cancel')}
        onDiscardAndTranscribe={() => resolveUnsavedSrt('discard')}
        onSaveAndTranscribe={() => resolveUnsavedSrt('save')}
      />
      <Modal
        open={downloadSwitchOpen}
        title={
          downloadSwitchContext === 'caption_recovery'
            ? t(
                'input.captionRecoverySwitchTitle',
                'Open captions without the current video?'
              )
            : t('input.downloadFinishedSwitchTitle', 'Watch downloaded video?')
        }
        titleId="download-switch-title"
        onClose={() => resolveDownloadSwitch(false)}
        hideCloseButton
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => resolveDownloadSwitch(false)}
            >
              {downloadSwitchContext === 'caption_recovery'
                ? t('input.captionRecoveryKeepVideo', 'Keep current video')
                : t('input.downloadFinishedWatchLater', 'Watch later')}
            </Button>
            <Button
              variant="primary"
              onClick={() => resolveDownloadSwitch(true)}
            >
              {downloadSwitchContext === 'caption_recovery'
                ? t('input.captionRecoveryOpenCaptions', 'Open captions')
                : t('input.downloadFinishedWatchNow', 'Watch now')}
            </Button>
          </>
        }
      >
        <div>
          {downloadSwitchContext === 'caption_recovery'
            ? t(
                'input.captionRecoverySwitchPrompt',
                'Translator recovered YouTube automatic captions, but the URL video is unavailable. Opening them will unmount the current video.'
              )
            : t(
                'input.downloadFinishedSwitchPrompt',
                'Your download is ready. Watch it now, or keep your current video and open it later from history.'
              )}
        </div>
      </Modal>
      <Modal
        open={Boolean(notice)}
        title={notice?.title ?? ''}
        titleId="app-notice-title"
        onClose={() => resolveNotice(null)}
        hideCloseButton
        actions={
          <>
            {notice?.buttons.map(button => (
              <Button
                key={button.id}
                variant={button.variant ?? 'secondary'}
                onClick={() => resolveNotice(button.id)}
              >
                {button.label}
              </Button>
            ))}
          </>
        }
      >
        <div className={noticeMessageStyles} dir="auto">
          {notice?.message}
        </div>
      </Modal>
      <LongDownloadConfirmDialog />
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
        {/* A link from this dialog that needs a human check is answered
            here; the app-level banner sits behind the dialog. */}
        <UrlCookieBanner />
        {hasMountedSubtitles ? (
          <label className={keepSubtitlesStyles}>
            <input
              type="checkbox"
              role="switch"
              checked={keepSubtitles}
              onChange={e => setKeepSubtitles(e.target.checked)}
            />
            <span>
              {t(
                'videoPlayer.changeVideoKeepSubtitlesSameVideo',
                'Keep the current subtitles. Only for another copy of this same video; a different video starts without them.'
              )}
            </span>
          </label>
        ) : null}
        <MediaInputSection
          videoFile={null}
          recentMedia={recentLocalMedia.filter(item => item.path !== videoPath)}
          onOpenFileDialog={async () => {
            const res = await openLocalMedia({ preserveSubtitles });
            if (!res.canceled) closeChangeVideo();
            return res;
          }}
          onOpenRecentFile={async path => {
            const res = await openRecentLocalMedia(path, {
              preserveSubtitles,
            });
            if (res.opened) closeChangeVideo();
          }}
          onRemoveRecentFile={removeRecentLocalMedia}
          isDownloadInProgress={download.inProgress}
          isTranslationInProgress={isTranslationInProgress || workspaceBusy}
          urlInput={urlInput}
          setUrlInput={setUrlInput}
          downloadQuality={downloadQuality}
          setDownloadQuality={setDownloadQuality}
          handleProcessUrl={async () => {
            // Downloading here is an explicit replace: the finished video
            // opens without a "Watch now?" question hidden behind the dialog.
            await downloadMedia({ preserveSubtitles, replaceCurrent: true });
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
          updateNotes?.version
            ? t('common.whatsNewVersionTitle', "What's new in v{{version}}", {
                version: updateNotes.version,
              })
            : t('common.whatsNewTitle', "What's new")
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
          {updateNotes?.version ? (
            <div>
              {t(
                'common.whatsNewLead',
                'Translator has been updated to v{{version}}.',
                { version: updateNotes.version }
              )}
            </div>
          ) : null}
          {/* Release notes are written once, in English (the tag body).
              Other languages get the localized lead above and can open the
              notes on purpose instead of being shown a wall of English. */}
          {isEnglishUi ? (
            <div className={updateNotesBodyStyles}>
              {updateNotes?.notes ?? ''}
            </div>
          ) : updateNotes?.notes ? (
            <details>
              <summary className={updateNotesDateStyles}>
                {t('common.whatsNewNotesInEnglish', 'Release notes (English)')}
              </summary>
              <div className={updateNotesBodyStyles} lang="en" dir="ltr">
                {updateNotes.notes}
              </div>
            </details>
          ) : null}
        </div>
      </Modal>
      <ApiKeysRequiredDialog
        open={apiKeysRequiredOpen}
        onClose={() => closeApiKeysRequired()}
      />
      <Modal
        open={requiredUpdateOpen}
        title={t('common.updateRequiredTitle', 'Update required')}
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
                {t('common.openDownloadPage', 'Open download page')}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => void handleRequiredUpdateAction()}
              disabled={updateDownloading || updateInstalling}
              isLoading={updateDownloading || updateInstalling}
            >
              {updateInstalling
                ? t('common.installingUpdate', 'Installing update...')
                : updateDownloaded
                  ? t('common.installUpdateNow', 'Install update')
                  : updateAvailable
                    ? t('common.downloadUpdateNow', 'Download update')
                    : t('common.checkForUpdateNow', 'Check for update')}
            </Button>
          </>
        }
        hideCloseButton
      >
        <div className={updateNotesDetailsStyles}>
          {/* Always the translated body: the server and main process send
              one English sentence, which is for logs only. */}
          <div>
            {t(
              'common.updateRequiredBody',
              'This version of Translator is no longer supported by the backend. Update the app to continue.'
            )}
          </div>
          {requiredUpdate?.minVersion && (
            <div className={updateNotesDateStyles}>
              {t(
                'common.minimumVersionValue',
                'Minimum supported version: v{{version}}',
                { version: requiredUpdate.minVersion }
              )}
            </div>
          )}
          {requiredUpdate?.clientVersion && (
            <div className={updateNotesDateStyles}>
              {t(
                'common.currentVersionValue',
                'Current version: v{{version}}',
                {
                  version: requiredUpdate.clientVersion,
                }
              )}
            </div>
          )}
          {updateCheckStatus === 'error' || updateCheckStatus === 'none' ? (
            <div className={updateNotesDateStyles} role="status">
              {t(
                'common.updateNotFoundUseDownloadPage',
                'The update couldn’t be downloaded here. Get the latest version from the download page.'
              )}
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

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
import { useUrlStore } from '../state/url-store';
import { useVideoStore, useTaskStore } from '../state';
import { css } from '@emotion/css';
import { colors } from '../styles';
import { useEffect, useRef } from 'react';
import LogsModal from './LogsModal';
import Modal from './Modal';
import Button from './Button';
import { useTranslation } from 'react-i18next';

const updateNotesDetailsStyles = css`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const updateNotesDateStyles = css`
  color: ${colors.textSecondary};
  font-size: 0.9rem;
`;

const updateNotesBodyStyles = css`
  max-height: min(55vh, 420px);
  overflow-y: auto;
  white-space: pre-wrap;
  line-height: 1.5;
`;

export default function GlobalModals() {
  const { t } = useTranslation();
  const unsavedOpen = useModalStore(s => s.unsavedSrtOpen);
  const creditOpen = useModalStore(s => s.creditRanOutOpen);
  const changeVideoOpen = useModalStore(s => s.changeVideoOpen);
  const logsOpen = useModalStore(s => s.logsOpen);
  const apiKeysRequiredOpen = useModalStore(s => s.apiKeysRequiredOpen);
  const updateNotesOpen = useModalStore(s => s.updateNotesOpen);
  const updateNotes = useModalStore(s => s.updateNotes);
  const toggleSettings = useUIStore(s => s.toggleSettings);
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
  const openFileDialogPreserveSubs = useVideoStore(
    s => s.openFileDialogPreserveSubs
  );
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
      {changeVideoOpen && (
        <div
          className={css`
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
          `}
          role="dialog"
          aria-modal="true"
          aria-label="Change Video"
          onClick={() => closeChangeVideo()}
        >
          <div
            className={css`
              background: ${colors.surface};
              border: 1px solid ${colors.border};
              border-radius: 10px;
              width: min(800px, 92vw);
              max-height: 88vh;
              overflow: auto;
              padding: 18px 16px;
              position: relative;
            `}
            onClick={e => e.stopPropagation()}
          >
            <button
              className={css`
                position: absolute;
                top: 10px;
                right: 10px;
                background: transparent;
                border: 1px solid ${colors.border};
                color: ${colors.text};
                border-radius: 4px;
                padding: 4px 8px;
                cursor: pointer;
              `}
              onClick={() => closeChangeVideo()}
            >
              ✕
            </button>
            <MediaInputSection
              videoFile={null}
              onOpenFileDialog={async () => {
                try {
                  const res = await openFileDialogPreserveSubs();
                  if (res && !(res as any).canceled) {
                    closeChangeVideo();
                  }
                } catch (err) {
                  console.error(
                    '[GlobalModals] change-video selection error:',
                    err
                  );
                }
              }}
              isDownloadInProgress={download.inProgress}
              isTranslationInProgress={isTranslationInProgress}
              urlInput={urlInput}
              setUrlInput={setUrlInput}
              downloadQuality={downloadQuality}
              setDownloadQuality={setDownloadQuality}
              handleProcessUrl={() => {
                closeChangeVideo();
                downloadMedia();
              }}
            />
          </div>
        </div>
      )}

      <LogsModal open={logsOpen} onClose={() => closeLogs()} />
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
        onClose={() => closeUpdateNotes()}
        actions={
          <Button variant="primary" onClick={() => closeUpdateNotes()}>
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
    </>
  );
}

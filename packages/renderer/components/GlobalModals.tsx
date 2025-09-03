import ConfirmReplaceSrtDialog from '../containers/GenerateSubtitles/components/ConfirmReplaceSrtDialog';
import CreditRanOutDialog from '../containers/GenerateSubtitles/components/CreditRanOutDialog';
import { useModalStore, resolveUnsavedSrt, resolveCreditRanOut, closeChangeVideo } from '../state/modal-store';
import { useUIStore } from '../state/ui-store';
import MediaInputSection from '../containers/GenerateSubtitles/components/MediaInputSection';
import { useUrlStore } from '../state/url-store';
import { useVideoStore, useTaskStore } from '../state';
import { css } from '@emotion/css';
import { colors } from '../styles';
import { useEffect, useRef } from 'react';

export default function GlobalModals() {
  const unsavedOpen = useModalStore(s => s.unsavedSrtOpen);
  const creditOpen = useModalStore(s => s.creditRanOutOpen);
  const changeVideoOpen = useModalStore(s => s.changeVideoOpen);
  const toggleSettings = useUIStore(s => s.toggleSettings);

  // Reuse existing stores for MediaInputSection
  const urlInput = useUrlStore(s => s.urlInput);
  const setUrlInput = useUrlStore(s => s.setUrlInput);
  const downloadQuality = useUrlStore(s => s.downloadQuality);
  const setDownloadQuality = useUrlStore(s => s.setDownloadQuality);
  const download = useUrlStore(s => s.download);
  const downloadMedia = useUrlStore(s => s.downloadMedia);
  const translation = useTaskStore(s => s.translation);
  const openFileDialogPreserveSubs = useVideoStore(s => s.openFileDialogPreserveSubs);
  const videoPath = useVideoStore(s => s.path);
  const videoFile = useVideoStore(s => s.file);

  // Close change-video modal once a new video mounts (path or file changes)
  const initialRef = useRef<{ path: string | null; hasFile: boolean } | null>(null);
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
              background: ${colors.light};
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
                color: ${colors.dark};
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
                  console.error('[GlobalModals] change-video selection error:', err);
                }
              }}
              isDownloadInProgress={download.inProgress}
              isTranslationInProgress={translation.inProgress}
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
    </>
  );
}

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/css';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import Button from '../Button';
import { useTaskStore, useVideoStore } from '../../state';
import { useExportStore } from '../../state/export-store';
import { useWorkspaceActions } from '../../state/workspace-actions';
import { logButton } from '../../utils/logger';
import { colors } from '../../styles';

const isMac =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent || '');

const baseName = (filePath: string) =>
  filePath.split(/[\\/]/).pop() || filePath;
const folderOf = (filePath: string) => {
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  return parts.join(filePath.includes('\\') ? '\\' : '/') || filePath;
};

const cardStyles = (tone: 'success' | 'error') => css`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 16px;
  background: ${colors.surface};
  border: 1px solid ${tone === 'success' ? colors.success : colors.danger};
  color: ${colors.text};
  font-size: 0.92rem;

  > svg {
    flex: none;
    margin-top: 2px;
    color: ${tone === 'success' ? colors.success : colors.danger};
  }
`;

const bodyStyles = css`
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 6px;
`;

const titleStyles = css`
  font-weight: 600;
`;

const detailStyles = css`
  color: ${colors.textDim};
  overflow-wrap: anywhere;
`;

const actionsStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const closeStyles = css`
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: ${colors.textDim};
  cursor: pointer;

  &:hover {
    background: ${colors.surfaceSoft};
    color: ${colors.text};
  }
`;

/**
 * The last export's result: where the video went (with Show in Finder and
 * Open), or why it failed (with Try again). Stays until dismissed, so it is
 * seen even when the export ran while the editor list was hidden.
 */
export function ExportOutcomeNotice({
  showRetry = true,
}: {
  showRetry?: boolean;
}) {
  const { t } = useTranslation();
  const outcome = useExportStore(s => s.outcome);
  const merging = useTaskStore(s => !!s.merge.inProgress);
  const editor = useWorkspaceActions(s => s.editor);
  const videoPath = useVideoStore(s => s.path);

  // A different video makes the old result irrelevant.
  const shownForVideo = useRef(videoPath);
  useEffect(() => {
    if (shownForVideo.current === videoPath) return;
    shownForVideo.current = videoPath;
    useExportStore.getState().setOutcome({ status: 'idle' });
  }, [videoPath]);

  if (merging || outcome.status === 'idle') return null;
  const dismiss = () =>
    useExportStore.getState().setOutcome({ status: 'idle' });
  const closeButton = (
    <button
      type="button"
      className={closeStyles}
      aria-label={t('common.close', 'Close')}
      onClick={dismiss}
    >
      <X size={16} aria-hidden="true" />
    </button>
  );

  if (outcome.status === 'success') {
    const { outputPath } = outcome;
    return (
      <div className={cardStyles('success')} role="status">
        <CheckCircle2 size={20} aria-hidden="true" />
        <div className={bodyStyles}>
          <span className={titleStyles}>
            {t('export.savedTitle', 'Video saved')}
          </span>
          <span className={detailStyles} title={outputPath}>
            {t('export.savedIn', '{{file}} in {{folder}}', {
              file: baseName(outputPath),
              folder: folderOf(outputPath),
            })}
          </span>
          <div className={actionsStyles}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                logButton('export_show_in_folder');
                window.appShell.showItemInFolder(outputPath);
              }}
            >
              {isMac
                ? t('export.showInFinder', 'Show in Finder')
                : t('export.showInFolder', 'Show in folder')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                logButton('export_open_video');
                void window.appShell.openPath(outputPath);
              }}
            >
              {t('export.openVideo', 'Open video')}
            </Button>
          </div>
        </div>
        {closeButton}
      </div>
    );
  }

  return (
    <div className={cardStyles('error')} role="alert">
      <AlertCircle size={20} aria-hidden="true" />
      <div className={bodyStyles}>
        <span className={titleStyles}>
          {t('export.failedTitle', 'The video wasn’t exported')}
        </span>
        <span className={detailStyles}>{outcome.message}</span>
        {showRetry && editor ? (
          <div className={actionsStyles}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                logButton('export_retry');
                dismiss();
                editor.merge();
              }}
            >
              {t('common.retry', 'Retry')}
            </Button>
          </div>
        ) : null}
      </div>
      {closeButton}
    </div>
  );
}

const destinationStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  min-width: 0;
`;

const destinationPathStyles = css`
  flex: 1 1 220px;
  min-width: 0;
  display: grid;
  gap: 2px;

  strong {
    font-weight: 600;
    color: ${colors.text};
    overflow-wrap: anywhere;
  }

  span {
    color: ${colors.textDim};
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
`;

/** "Save to <file> in <folder> [Change…]", settled before the export starts. */
export function ExportDestinationField({
  labelClassName,
  disabled = false,
}: {
  labelClassName?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const videoPath = useVideoStore(s => s.path);
  const destinationPath = useExportStore(s =>
    s.forVideo === videoPath ? s.destinationPath : null
  );

  useEffect(() => {
    void useExportStore.getState().prepareDestination(videoPath);
  }, [videoPath]);

  if (!videoPath) return null;
  return (
    <div className={destinationStyles}>
      <span className={labelClassName}>{t('export.saveTo', 'Save to')}</span>
      <div className={destinationPathStyles} title={destinationPath ?? ''}>
        {destinationPath ? (
          <>
            <strong>{baseName(destinationPath)}</strong>
            <span>{folderOf(destinationPath)}</span>
          </>
        ) : (
          <span>…</span>
        )}
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => {
          logButton('export_change_destination');
          void useExportStore.getState().chooseDestination(videoPath);
        }}
      >
        {t('export.changeDestination', 'Change…')}
      </Button>
    </div>
  );
}

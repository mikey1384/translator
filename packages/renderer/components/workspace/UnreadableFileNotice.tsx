import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import Button from '../Button';
import { useVideoStore } from '../../state';
import { openChangeVideo } from '../../state/modal-store';
import { unreadableFileMessage } from '../../containers/GenerateSubtitles/hooks/useVideoMetadata';
import { logButton } from '../../utils/logger';
import { colors } from '../../styles';
import { idleDotStyles, idleStatusStyles } from './workspace-styles';

const messageStyles = css`
  flex: 1 1 240px;
  min-width: 0;
  color: ${colors.text};
`;

/** True when the mounted file's metadata could not be read at all. */
export function useMountedFileUnreadable(): boolean {
  return useVideoStore(s =>
    Boolean(s.path && s.metaError && s.metaError.path === s.path)
  );
}

/**
 * True while the mounted file's first probe is still out: until then nobody
 * knows whether it can be read, so no "Ready" and no run action yet.
 */
export function useMountedFileChecking(): boolean {
  return useVideoStore(s =>
    Boolean(
      s.path &&
      s.metaPath !== s.path &&
      !(s.metaError && s.metaError.path === s.path)
    )
  );
}

/** The calm line shown while a just-opened file is being read. */
export function CheckingFileNotice() {
  const { t } = useTranslation();
  return (
    <div className={idleStatusStyles}>
      <span className={idleDotStyles(colors.gray)} aria-hidden="true" />
      <span className={messageStyles} role="status">
        {t('workspace.checkingFile', 'Reading the file…')}
      </span>
    </div>
  );
}

/**
 * Replaces the "Ready" line for a damaged or unsupported file: nothing can
 * run on it, so say so and offer another file.
 */
export default function UnreadableFileNotice() {
  const { t } = useTranslation();
  return (
    <div className={idleStatusStyles}>
      <span className={idleDotStyles(colors.danger)} aria-hidden="true" />
      <span className={messageStyles} role="alert">
        {unreadableFileMessage()}
      </span>
      <Button
        variant="secondary"
        size="md"
        onClick={() => {
          logButton('workspace_unreadable_change_video');
          openChangeVideo();
        }}
      >
        {t('workspace.chooseAnotherFile', 'Choose another file')}
      </Button>
    </div>
  );
}

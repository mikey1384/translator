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

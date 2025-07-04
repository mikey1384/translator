import Button from '../../components/Button.js';
import { buttonGradientStyles } from '../../styles.js';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';

interface SaveMenuProps {
  onSave: () => Promise<void>;
  onSaveAs: () => Promise<void>;
  canSaveDirectly: boolean;
  subtitlesExist: boolean;
}

export default function SaveMenu({
  onSave,
  onSaveAs,
  canSaveDirectly,
  subtitlesExist,
}: SaveMenuProps) {
  const { t } = useTranslation();

  if (!subtitlesExist) {
    return null;
  }

  return (
    <div
      className={css`
        display: flex;
        align-items: center;
        gap: 10px;
        // Removed justify-content, border, padding as it will be part of the action bar
      `}
    >
      <Button
        onClick={onSave}
        variant="primary"
        size="md"
        className={`${buttonGradientStyles.base} ${buttonGradientStyles.primary}`}
        disabled={!canSaveDirectly}
        title={
          !canSaveDirectly
            ? t('editSubtitles.header.saveAsTooltip')
            : t('editSubtitles.header.saveTooltip')
        }
      >
        <div
          className={css`
            display: flex;
            align-items: center;
          `}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: '8px' }}
          >
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
          {t('editSubtitles.header.save')}
        </div>
      </Button>

      <Button onClick={onSaveAs} variant="secondary" size="md">
        <div
          className={css`
            display: flex;
            align-items: center;
          `}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: '8px' }}
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {t('editSubtitles.header.saveAs')}
        </div>
      </Button>
    </div>
  );
}

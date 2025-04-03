import Button from '../../components/Button';
import { buttonGradientStyles } from '../../styles';
import { css } from '@emotion/css';

interface EditSubtitlesHeaderProps {
  onSave: () => Promise<void>;
  onSaveAs: () => Promise<void>;
  canSaveDirectly: boolean;
  subtitlesExist: boolean;
}

// Use function declaration syntax
function EditSubtitlesHeader({
  onSave,
  onSaveAs,
  canSaveDirectly,
  subtitlesExist,
}: EditSubtitlesHeaderProps) {
  // If no subtitles exist, render nothing or a placeholder
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
      {/* Save Button */}
      <Button
        onClick={onSave}
        variant="primary"
        size="md"
        className={`${buttonGradientStyles.base} ${buttonGradientStyles.primary}`}
        disabled={!canSaveDirectly}
        title={
          !canSaveDirectly
            ? 'Save As first to enable direct save'
            : 'Save changes to original file'
        }
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
        Save
      </Button>

      {/* Save As Button */}
      <Button onClick={onSaveAs} variant="secondary" size="md">
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
        Save As
      </Button>
    </div>
  );
}

export default EditSubtitlesHeader;

import Button from '../../components/Button.js';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../state/ui-store.js';
import { SubtitleStylePresetKey } from '../../../shared/constants/subtitle-styles.js';
import {
  editorButtonContentStyles,
  editorMergeButtonStyles,
  editorToolbarActionRowStyles,
  editorToolbarCheckboxInputStyles,
  editorToolbarCheckboxLabelStyles,
  editorToolbarCompactInputStyles,
  editorToolbarFieldGridStyles,
  editorToolbarFieldStyles,
  editorToolbarGridStyles,
  editorToolbarLabelStyles,
  editorToolbarPrimarySectionStyles,
  editorToolbarSectionStyles,
  editorToolbarSelectStyles,
} from './edit-workspace-styles';

interface SaveAndMergeBarProps {
  onSave: () => Promise<void>;
  onSaveAs: () => Promise<void>;
  onMerge: () => void;
  canSaveDirectly: boolean;
  subtitlesExist: boolean;
  videoFileExists: boolean;
  isMergingInProgress: boolean;
  isTranslationInProgress?: boolean;
}

export default function SaveAndMergeBar({
  onSave,
  onSaveAs,
  onMerge,
  canSaveDirectly,
  subtitlesExist,
  videoFileExists,
  isMergingInProgress,
  isTranslationInProgress,
}: SaveAndMergeBarProps) {
  const { t } = useTranslation();

  const fontSize = useUIStore(s => s.baseFontSize);
  const stylePreset = useUIStore(s => s.subtitleStyle);
  const setStylePreset = useUIStore(s => s.setSubtitleStyle);
  const showOriginal = useUIStore(s => s.showOriginalText);
  const setShowOriginal = useUIStore(s => s.setShowOriginalText);

  if (!subtitlesExist) return null;

  return (
    <div className={editorToolbarGridStyles}>
      <div
        className={`${editorToolbarSectionStyles} ${editorToolbarPrimarySectionStyles}`}
      >
        <div className={editorToolbarActionRowStyles}>
          <Button
            onClick={onSave}
            variant="primary"
            size="sm"
            disabled={!canSaveDirectly}
            title={
              !canSaveDirectly
                ? t('editSubtitles.header.saveAsTooltip')
                : t('editSubtitles.header.saveTooltip')
            }
          >
            <div className={editorButtonContentStyles}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
              {t('editSubtitles.header.save')}
            </div>
          </Button>

          <Button onClick={onSaveAs} variant="secondary" size="sm">
            <div className={editorButtonContentStyles}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t('editSubtitles.header.saveAs')}
            </div>
          </Button>

          <Button
            onClick={onMerge}
            disabled={
              !videoFileExists ||
              !subtitlesExist ||
              isMergingInProgress ||
              !!isTranslationInProgress
            }
            isLoading={isMergingInProgress}
            className={editorMergeButtonStyles}
            size="sm"
            title={
              videoFileExists
                ? undefined
                : t(
                    'editSubtitles.workspace.mergeNeedsVideoCopy',
                    'Mount a source video before starting a burn-in export.'
                  )
            }
          >
            <div className={editorButtonContentStyles}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V9l-7-7z" />
                <path d="M13 3v6h6" />
                <path d="M16 13H8" />
                <path d="M16 17H8" />
                <path d="M10 9H8" />
              </svg>
              <span>
                {isMergingInProgress
                  ? t('editSubtitles.mergeControls.mergingButton')
                  : t('editSubtitles.mergeControls.mergeButton')}
              </span>
            </div>
          </Button>
        </div>
      </div>

      <div className={editorToolbarSectionStyles}>
        <div className={editorToolbarFieldGridStyles}>
          <div className={editorToolbarFieldStyles}>
            <label className={editorToolbarLabelStyles}>
              {t('editSubtitles.mergeControls.fontSizeLabel')}
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className={editorToolbarCompactInputStyles}
              value={fontSize || ''}
              onChange={e => {
                const s = e.target.value;
                if (s === '') return useUIStore.getState().setBaseFontSize(0);
                const digits = s.replace(/\D/g, '');
                useUIStore.getState().setBaseFontSize(Number(digits || 0));
              }}
              onBlur={() => {
                const size = useUIStore.getState().baseFontSize || 10;
                const clamped = Math.max(10, Math.min(size, 72));
                useUIStore.getState().setBaseFontSize(clamped);
              }}
            />
          </div>

          <div className={editorToolbarFieldStyles}>
            <label
              className={editorToolbarLabelStyles}
              htmlFor="mergeStylePresetSelect"
            >
              {t('editSubtitles.mergeControls.styleLabel')}
            </label>
            <select
              id="mergeStylePresetSelect"
              className={editorToolbarSelectStyles}
              value={stylePreset}
              onChange={e =>
                setStylePreset(e.target.value as SubtitleStylePresetKey)
              }
            >
              {(
                [
                  'Default',
                  'Classic',
                  'Boxed',
                  'LineBox',
                ] as SubtitleStylePresetKey[]
              ).map(key => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </div>
          <div className={editorToolbarFieldStyles}>
            <label
              className={editorToolbarCheckboxLabelStyles}
              htmlFor="mergeShowOriginalToggle"
            >
              <input
                id="mergeShowOriginalToggle"
                type="checkbox"
                className={editorToolbarCheckboxInputStyles}
                checked={showOriginal}
                onChange={e => setShowOriginal(e.target.checked)}
                aria-label={t('subtitles.showOriginalText')}
              />
              <span>{t('subtitles.showOriginalText')}</span>
            </label>
          </div>
        </div>
      </div>

    </div>
  );
}

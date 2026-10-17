import Button from '../../components/Button.js';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../state/ui-store.js';
import { useSubStore } from '../../state/subtitle-store.js';
import type { SubtitleDisplayMode } from '@shared-types/app';
import { SubtitleSizeStepper } from '../../components/SubtitleViewControls.js';
import {
  ExportDestinationField,
  ExportOutcomeNotice,
} from '../../components/workspace/ExportResult.js';
import SubtitleStylePicker, {
  subtitleStyleLabel,
} from './SubtitleStylePicker.js';
import {
  SUBTITLE_STYLE_PRESET_ORDER,
  type SubtitleStylePresetKey,
} from '../../../shared/constants/subtitle-styles.js';
import {
  editorButtonContentStyles,
  editorSaveButtonStyles,
  editorToolbarActionRowStyles,
  editorToolbarFieldGridStyles,
  editorToolbarFieldStyles,
  editorToolbarFullRowStyles,
  editorToolbarGridStyles,
  editorToolbarLabelStyles,
  editorToolbarPrimarySectionStyles,
  editorToolbarSectionStyles,
  editorToolbarSelectStyles,
  editorToolbarStyleFieldStyles,
} from './edit-workspace-styles';

interface SaveAndMergeBarProps {
  onSave: () => Promise<void>;
  onSaveAs: () => Promise<void>;
  onMerge: () => void;
  canSaveDirectly: boolean;
  subtitlesExist: boolean;
  videoFileExists: boolean;
  isExportLocked?: boolean;
  isMergingInProgress: boolean;
  isTranslationInProgress?: boolean;
  /**
   * The export sheet: only what shapes the video and where it goes, with
   * Export as its one yellow action (saving .srt lives elsewhere).
   */
  primaryMerge?: boolean;
}

export default function SaveAndMergeBar({
  onSave,
  onSaveAs,
  onMerge,
  canSaveDirectly,
  subtitlesExist,
  videoFileExists,
  isExportLocked = false,
  isMergingInProgress,
  isTranslationInProgress,
  primaryMerge = false,
}: SaveAndMergeBarProps) {
  const { t } = useTranslation();

  const stylePreset = useUIStore(s => s.subtitleStyle);
  const setStylePreset = useUIStore(s => s.setSubtitleStyle);
  const subtitleDisplayMode = useUIStore(s => s.subtitleDisplayMode);
  const setSubtitleDisplayMode = useUIStore(s => s.setSubtitleDisplayMode);
  const hasTranslation = useSubStore(s =>
    s.order.some(id => Boolean(s.segments[id]?.translation?.trim()))
  );
  // With nothing translated every mode shows the original lines; say so
  // instead of offering choices that change nothing.
  const effectiveDisplayMode: SubtitleDisplayMode = hasTranslation
    ? subtitleDisplayMode
    : 'original';
  const exportDisabled =
    isExportLocked ||
    !videoFileExists ||
    !subtitlesExist ||
    isMergingInProgress ||
    !!isTranslationInProgress;

  if (!subtitlesExist) return null;

  const exportButton = (
    <Button
      onClick={onMerge}
      disabled={exportDisabled}
      isLoading={isMergingInProgress}
      variant={primaryMerge ? 'primary' : 'secondary'}
      size={primaryMerge ? 'lg' : 'sm'}
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
          aria-hidden="true"
        >
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M7 15h10" />
        </svg>
        <span>
          {isMergingInProgress
            ? t('export.exportingButton', 'Exporting…')
            : t('export.exportButton', 'Export video')}
        </span>
      </div>
    </Button>
  );

  return (
    <div className={editorToolbarGridStyles}>
      {primaryMerge ? null : (
        <div
          className={`${editorToolbarSectionStyles} ${editorToolbarPrimarySectionStyles}`}
        >
          <div className={editorToolbarActionRowStyles}>
            <Button
              onClick={onSave}
              variant="secondary"
              size="sm"
              disabled={!canSaveDirectly || isExportLocked}
              className={editorSaveButtonStyles}
              title={t('editSubtitles.header.saveTooltip')}
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

            <Button
              onClick={onSaveAs}
              variant="secondary"
              size="sm"
              disabled={isExportLocked}
              className={editorSaveButtonStyles}
              title={t('editSubtitles.header.saveAsTooltip')}
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
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {t('editSubtitles.header.saveAs')}
              </div>
            </Button>

            {exportButton}
          </div>
        </div>
      )}

      <div className={editorToolbarSectionStyles}>
        <div className={editorToolbarFieldGridStyles}>
          <div className={editorToolbarFieldStyles}>
            <span className={editorToolbarLabelStyles}>
              {t('workspace.textSize', 'Text size')}
            </span>
            <SubtitleSizeStepper />
          </div>

          {primaryMerge ? null : (
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
                {SUBTITLE_STYLE_PRESET_ORDER.map(key => (
                  <option key={key} value={key}>
                    {subtitleStyleLabel(t, key)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={editorToolbarFieldStyles}>
            <label
              className={editorToolbarLabelStyles}
              htmlFor="subtitleDisplayModeSelect"
            >
              {t('subtitles.displayModeLabel', 'Subtitle display')}
            </label>
            <select
              id="subtitleDisplayModeSelect"
              className={editorToolbarSelectStyles}
              value={effectiveDisplayMode}
              onChange={e =>
                setSubtitleDisplayMode(e.target.value as SubtitleDisplayMode)
              }
              title={
                hasTranslation
                  ? undefined
                  : t(
                      'export.displayNeedsTranslation',
                      'Translate the subtitles to show the translation or both.'
                    )
              }
            >
              <option value="original">
                {t('editSubtitles.workspace.originalLabel', 'Original')}
              </option>
              <option value="translation" disabled={!hasTranslation}>
                {t(
                  'editSubtitles.workspace.translationMode',
                  'Translation-only mode'
                )}
              </option>
              <option value="dual" disabled={!hasTranslation}>
                {t('editSubtitles.workspace.dualMode', 'Dual text mode')}
              </option>
            </select>
          </div>
        </div>
      </div>

      {primaryMerge ? (
        <div
          className={`${editorToolbarSectionStyles} ${editorToolbarFullRowStyles}`}
        >
          <div className={editorToolbarStyleFieldStyles}>
            <span className={editorToolbarLabelStyles}>
              {t('editSubtitles.mergeControls.styleLabel')}
            </span>
            <SubtitleStylePicker
              value={stylePreset}
              onChange={setStylePreset}
            />
          </div>
        </div>
      ) : null}

      <div className={editorToolbarFullRowStyles}>
        <ExportDestinationField
          labelClassName={editorToolbarLabelStyles}
          disabled={isMergingInProgress}
        />
      </div>

      {primaryMerge ? (
        <>
          <div className={editorToolbarFullRowStyles}>
            <ExportOutcomeNotice showRetry={false} />
          </div>
          <div className={editorToolbarFullRowStyles}>{exportButton}</div>
        </>
      ) : null}
    </div>
  );
}

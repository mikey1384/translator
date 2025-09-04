import Button from '../../components/Button.js';
import { buttonGradientStyles, colors } from '../../styles.js';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../state/ui-store.js';
import { SubtitleStylePresetKey } from '../../../shared/constants/subtitle-styles.js';

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

const mergeButtonStyle = css`
  background-color: ${colors.warning};
  border-color: ${colors.warning};
  color: #ffffff !important;
  &:hover:not(:disabled) {
    background-color: #e0488a;
    border-color: #e0488a;
  }
  &:active:not(:disabled) {
    background-color: #c7407b;
    border-color: #c7407b;
  }
`;

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

  const [fontSize, setFontSize] = useUIStore(s => [
    s.baseFontSize,
    s.setBaseFontSize,
  ]);
  const [stylePreset, setStylePreset] = useUIStore(s => [
    s.subtitleStyle,
    s.setSubtitleStyle,
  ]);
  const [showOriginal, setShowOriginal] = useUIStore(s => [
    s.showOriginalText,
    s.setShowOriginalText,
  ]);

  if (!subtitlesExist) return null;

  return (
    <div
      className={css`
        width: 100%;
        display: flex;
        justify-content: center; /* center the block in the footer */
      `}
    >
      <div
        className={css`
          display: grid;
          grid-template-columns: auto auto auto; /* left, middle, right */
          column-gap: 24px;
          row-gap: 8px;
          align-items: center;
          justify-items: center; /* center default cells */
          width: max-content;
        `}
      >
        {/* Row 1, Col 1: Save + Save As */}
        <div
          className={css`
            display: flex;
            align-items: center;
            gap: 10px;
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

        {/* Row 1, Col 2: text size */}
        <div
          className={css`
            display: flex;
            align-items: center;
            gap: 8px;
          `}
        >
          <label
            className={css`
              font-weight: 500;
              color: ${colors.grayDark};
            `}
          >
            {t('editSubtitles.mergeControls.fontSizeLabel')}
          </label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            className={css`
              padding: 0.25rem 0.5rem;
              border: 1px solid ${colors.border};
              border-radius: 4px;
              font-size: 1rem;
              width: 56px;
              max-width: 64px;
              text-align: center;
              background-color: ${colors.light};
              color: ${colors.dark};
            `}
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

        {/* Row 2, Col 1: Merge button */}
        <div>
          <Button
            onClick={onMerge}
            disabled={
              !videoFileExists ||
              !subtitlesExist ||
              isMergingInProgress ||
              !!isTranslationInProgress
            }
            isLoading={isMergingInProgress}
            className={mergeButtonStyle}
            size="md"
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
                <path d="M13 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V9l-7-7z" />
                <path d="M13 3v6h6" />
                <path d="M16 13H8" />
                <path d="M16 17H8" />
                <path d="M10 9H8" />
              </svg>
              {isMergingInProgress
                ? t('editSubtitles.mergeControls.mergingButton')
                : t('editSubtitles.mergeControls.mergeButton')}
            </div>
          </Button>
        </div>

        {/* Row 2, Col 2: Style select */}
        <div
          className={css`
            display: flex;
            align-items: center;
            gap: 8px;
          `}
        >
          <label
            className={css`
              font-weight: 500;
              color: ${colors.grayDark};
            `}
            htmlFor="mergeStylePresetSelect"
          >
            {t('editSubtitles.mergeControls.styleLabel')}
          </label>
          <select
            id="mergeStylePresetSelect"
            className={css`
              padding: 0.5rem 0.75rem;
              border: 1px solid ${colors.border};
              border-radius: 4px;
              font-size: 1rem;
              background-color: ${colors.light};
              color: ${colors.dark};
              cursor: pointer;
            `}
            value={stylePreset}
            onChange={e =>
              setStylePreset(e.target.value as SubtitleStylePresetKey)
            }
          >
            {(['Default', 'Classic', 'Boxed', 'LineBox'] as SubtitleStylePresetKey[]).map(
              key => (
                <option key={key} value={key}>
                  {key}
                </option>
              )
            )}
          </select>
        </div>

        {/* Right end column: Show original text (spans two rows, vertically centered) */}
        <div
          className={css`
            grid-column: 3;
            grid-row: 1 / span 2;
            align-self: center;
            justify-self: end;
            display: inline-flex;
            align-items: center;
            gap: 8px;
          `}
        >
          <label
            className={css`
              font-weight: 500;
              color: ${colors.grayDark};
            `}
            htmlFor="mergeShowOriginalToggle"
          >
            {t('subtitles.showOriginalText')}
          </label>
          <input
            id="mergeShowOriginalToggle"
            type="checkbox"
            checked={showOriginal}
            onChange={e => setShowOriginal(e.target.checked)}
            aria-label={t('subtitles.showOriginalText')}
          />
        </div>
      </div>
    </div>
  );
}

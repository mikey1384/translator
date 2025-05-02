import { useState } from 'react';
import { css } from '@emotion/css';
import Button from '../../components/Button.js';
import { SrtSegment, EditArgs } from '@shared-types/app';
import { colors } from '../../styles.js';
import { HighlightedTextarea } from '../../components/HighlightedTextarea.js';
import { useTranslation } from 'react-i18next';

const timeInputStyles = css`
  width: 150px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid ${colors.border};
  background-color: ${colors.grayLight};
  color: ${colors.dark};
  font-family: monospace;
  transition: border-color 0.2s ease;
  &:focus {
    outline: none;
    border-color: ${colors.primary};
  }
`;

const actionButtonsStyles = css`
  display: flex;
  gap: 8px;
  align-items: center;
`;

export default function SubtitleEditor({
  sub,
  index,
  editingTimes,
  isPlaying,
  secondsToSrtTime,
  onEditSubtitle,
  onTimeInputBlur,
  onRemoveSubtitle,
  onInsertSubtitle,
  onSeekToSubtitle,
  onPlaySubtitle,
  onShiftSubtitle,
  isShiftingDisabled,
  searchText,
}: {
  sub: SrtSegment;
  index: number;
  editingTimes: Record<string, string>;
  isPlaying: boolean;
  secondsToSrtTime: (seconds: number) => string;
  onEditSubtitle: ({ index, field, value }: EditArgs) => void;
  onTimeInputBlur: (index: number, field: 'start' | 'end') => void;
  onRemoveSubtitle: (index: number) => void;
  onInsertSubtitle: (index: number) => void;
  onSeekToSubtitle: (startTime: number) => void;
  onPlaySubtitle: (startTime: number, endTime: number) => void;
  onShiftSubtitle: (index: number, shiftSeconds: number) => void;
  isShiftingDisabled: boolean;
  searchText?: string;
}) {
  const { t } = useTranslation();
  const [shiftAmount, setShiftAmount] = useState('0');

  return (
    <div
      className={css`
        background-color: ${colors.light};
        border: 1px solid ${colors.border};
        border-radius: 8px;
        padding: 15px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      `}
    >
      <div
        className={css`
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        `}
      >
        <span
          className={css`
            font-weight: bold;
            color: ${colors.grayDark};
            font-size: 1.1em;
          `}
        >
          #{sub.index}
        </span>
        <div className={actionButtonsStyles}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onSeekToSubtitle(sub.start)}
            title={t('editSubtitles.item.seekTitle')}
          >
            {t('editSubtitles.item.seek')}
          </Button>
          <Button
            variant={isPlaying ? 'danger' : 'primary'}
            size="sm"
            onClick={() => onPlaySubtitle(sub.start, sub.end)}
            title={
              isPlaying
                ? t('editSubtitles.item.pauseSnippet')
                : t('editSubtitles.item.playSnippet')
            }
          >
            {isPlaying ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
                style={{ verticalAlign: 'middle' }}
              >
                <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z" />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
                style={{ verticalAlign: 'middle' }}
              >
                <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z" />
              </svg>
            )}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onInsertSubtitle(index)}
            title={t('editSubtitles.item.insertTitle')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ verticalAlign: 'middle' }}
            >
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => onRemoveSubtitle(index)}
            title={t('editSubtitles.item.removeTitle')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ verticalAlign: 'middle' }}
            >
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
              <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
              <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
            </svg>
          </Button>
        </div>
      </div>

      {/* --- Replace Textarea with HighlightedTextarea --- START --- */}
      <HighlightedTextarea
        value={sub.original}
        searchTerm={searchText || ''}
        onChange={v => onEditSubtitle({ index, field: 'original', value: v })}
        rows={4}
        placeholder={t('editSubtitles.item.subtitlePlaceholder')}
      />
      <HighlightedTextarea
        value={sub.translation ?? ''}
        searchTerm={searchText || ''}
        onChange={v =>
          onEditSubtitle({ index, field: 'translation', value: v })
        }
        rows={4}
        placeholder={t('editSubtitles.item.subtitlePlaceholder')}
      />

      <div
        className={css`
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        `}
      >
        <div className={actionButtonsStyles}>
          <input
            type="text"
            value={
              editingTimes[`${index}-start`] ?? secondsToSrtTime(sub.start)
            }
            onChange={e => handleTimeChange('start', e.target.value)}
            onBlur={() => onTimeInputBlur(index, 'start')}
            className={timeInputStyles}
            aria-label={`Start time for subtitle ${sub.index}`}
            data-testid={`subtitle-start-${index}`}
          />
          <span>→</span>
          <input
            type="text"
            value={editingTimes[`${index}-end`] ?? secondsToSrtTime(sub.end)}
            onChange={e => handleTimeChange('end', e.target.value)}
            onBlur={() => onTimeInputBlur(index, 'end')}
            className={timeInputStyles}
            aria-label={`End time for subtitle ${sub.index}`}
            data-testid={`subtitle-end-${index}`}
          />
          <span style={{ marginLeft: '8px', color: colors.gray }}>|</span>
          <input
            type="number"
            step="0.1"
            value={shiftAmount}
            onChange={e => setShiftAmount(e.target.value)}
            onBlur={handleApplyShift}
            onKeyDown={e => e.key === 'Enter' && handleApplyShift()}
            className={timeInputStyles}
            placeholder={t('editSubtitles.item.shiftPlaceholder')}
            title={t('editSubtitles.item.shiftTitle')}
            disabled={isShiftingDisabled}
            data-testid={`subtitle-shift-input-${index}`}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleApplyShift}
            disabled={
              isShiftingDisabled ||
              !shiftAmount ||
              parseFloat(shiftAmount) === 0
            }
            data-testid={`subtitle-shift-button-${index}`}
          >
            {t('editSubtitles.item.applyShift')}
          </Button>
        </div>
      </div>
    </div>
  );

  function handleTimeChange(field: 'start' | 'end', value: string) {
    onEditSubtitle({ index, field, value });
  }

  function handleApplyShift() {
    const offset = parseFloat(shiftAmount);
    if (!isNaN(offset) && offset !== 0) {
      onShiftSubtitle(index, offset);
    }
  }
}

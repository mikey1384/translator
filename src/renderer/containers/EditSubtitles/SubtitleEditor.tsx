import { useState, useEffect } from 'react';
import { css } from '@emotion/css';
import Button from '../../components/Button.js';
import { SrtSegment } from '../../../types/interface.js';
import { colors } from '../../styles.js';
import { HighlightedTextarea } from '../../components/HighlightedTextarea.js';

interface SubtitleEditorProps {
  sub: SrtSegment;
  index: number;
  editingTimes: Record<string, string>;
  isPlaying: boolean;
  secondsToSrtTime: (seconds: number) => string;
  onEditSubtitle: (
    index: number,
    field: 'start' | 'end' | 'text',
    value: number | string
  ) => void;
  onTimeInputBlur: (index: number, field: 'start' | 'end') => void;
  onRemoveSubtitle: (index: number) => void;
  onInsertSubtitle: (index: number) => void;
  onSeekToSubtitle: (startTime: number) => void;
  onPlaySubtitle: (startTime: number, endTime: number) => void;
  onShiftSubtitle: (index: number, shiftSeconds: number) => void;
  isShiftingDisabled: boolean;
  searchText?: string;
}

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
}: SubtitleEditorProps) {
  let originalText = '';
  let initialEditableText = sub.text;
  const hasMarker = sub.text.includes('###TRANSLATION_MARKER###');

  if (hasMarker) {
    const parts = sub.text.split('###TRANSLATION_MARKER###');
    originalText = parts[0] || '';
    initialEditableText = parts[1] || '';
  }
  const [currentTextValue, setCurrentTextValue] =
    useState<string>(initialEditableText);
  const [shiftAmount, setShiftAmount] = useState('0');

  useEffect(() => {
    let incomingEditableText = sub.text;
    if (sub.text.includes('###TRANSLATION_MARKER###')) {
      incomingEditableText =
        sub.text.split('###TRANSLATION_MARKER###')[1] || '';
    }
    if (incomingEditableText !== currentTextValue) {
      setCurrentTextValue(incomingEditableText);
    }
  }, [sub.text]);

  const handleTextChange = (newValue: string) => {
    setCurrentTextValue(newValue);
    onEditSubtitle(index, 'text', newValue);
  };

  const handleTimeChange = (field: 'start' | 'end', value: string) => {
    onEditSubtitle(index, field, value); // Update immediately for visual feedback
  };

  const handleApplyShift = () => {
    const offset = parseFloat(shiftAmount);
    if (!isNaN(offset) && offset !== 0) {
      onShiftSubtitle(index, offset);
    }
  };

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
            title="Seek video to start time"
          >
            Seek
          </Button>
          <Button
            variant={isPlaying ? 'danger' : 'primary'}
            size="sm"
            onClick={() => onPlaySubtitle(sub.start, sub.end)}
            title={isPlaying ? 'Pause snippet' : 'Play snippet'}
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
            title="Insert new subtitle block after this one"
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
            title="Remove this subtitle block"
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

      {/* Original Text Display (Conditional) */}
      {hasMarker && originalText && (
        <div
          className={css`
            background-color: ${colors.grayLight};
            border: 1px dashed ${colors.gray};
            color: ${colors.grayDark};
            padding: 8px;
            border-radius: 4px;
            font-size: 0.9em;
            margin-top: 8px;
            white-space: pre-wrap;
            font-style: italic;
          `}
        >
          Original: {originalText}
        </div>
      )}

      {/* --- Replace Textarea with HighlightedTextarea --- START --- */}
      <HighlightedTextarea
        value={currentTextValue}
        searchTerm={searchText || ''}
        onChange={handleTextChange}
        rows={4} // Adjust rows as needed
        placeholder="Subtitle text"
      />
      {/* --- Replace Textarea with HighlightedTextarea --- END --- */}

      {/* Bottom Row: Time Inputs, Shift Controls - Now all grouped */}
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
            className={css`
              width: 60px; // Smaller shift input
              padding: 6px 8px;
              border-radius: 4px;
              border: 1px solid ${colors.border};
              background-color: ${colors.grayLight};
              color: ${colors.dark};
              font-family: monospace;
              text-align: right;
              margin-left: 5px; // Keep margin if needed next to button
              transition: border-color 0.2s ease;
              &:focus {
                outline: none;
                border-color: ${colors.primary};
              }
            `}
            aria-label={`Shift subtitle ${sub.index} by seconds`}
            disabled={isShiftingDisabled}
            data-testid={`subtitle-shift-input-${index}`}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleApplyShift}
            title="Shift this subtitle start and end times"
            disabled={
              isShiftingDisabled ||
              isNaN(parseFloat(shiftAmount)) ||
              parseFloat(shiftAmount) === 0
            }
            data-testid={`subtitle-shift-button-${index}`}
          >
            Shift
          </Button>
        </div>
      </div>
    </div>
  );
}

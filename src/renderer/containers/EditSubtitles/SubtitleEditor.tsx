import React, { useState, useEffect, useRef, useCallback } from 'react';
import { css } from '@emotion/css';
import Button from '../../components/Button';
import { SrtSegment } from '../../../types/interface';
import { debounce } from 'lodash';
import { DEBOUNCE_DELAY_MS } from './constants';

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
}

// Style for the textarea
const textInputStyles = {
  width: '100%',
  minHeight: '60px',
  padding: '8px',
  borderRadius: 4,
  border: '1px solid rgba(221, 221, 221, 0.8)',
  backgroundColor: 'rgba(255, 255, 255, 0.9)',
  resize: 'vertical' as const,
  fontFamily: 'monospace',
  fontSize: 'inherit',
  lineHeight: '1.4',
  whiteSpace: 'pre-wrap' as const,
};

// Style for time inputs
const timeInputStyles = css`
  width: 150px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid rgba(221, 221, 221, 0.8);
  background-color: rgba(255, 255, 255, 0.9);
  font-family: monospace;
  transition: border-color 0.2s ease;
  &:focus {
    outline: none;
    border-color: rgba(0, 123, 255, 0.8);
    box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
  }
`;

// Add gradient styles for buttons
const buttonGradientStyles = {
  base: css`
    position: relative;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transition: all 0.2s ease;
    color: white !important;

    &:hover:not(:disabled) {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      color: white !important;
    }

    &:active:not(:disabled) {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      color: white !important;
    }

    &:disabled {
      opacity: 0.65;
      cursor: not-allowed;
      color: rgba(255, 255, 255, 0.9) !important;
    }
  `,
  primary: css`
    background: linear-gradient(
      135deg,
      rgba(0, 123, 255, 0.9),
      rgba(0, 80, 188, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(0, 143, 255, 0.95),
        rgba(0, 103, 204, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(0, 123, 255, 0.6),
        rgba(0, 80, 188, 0.6)
      ) !important;
    }
  `,
  success: css`
    background: linear-gradient(
      135deg,
      rgba(40, 167, 69, 0.9),
      rgba(30, 126, 52, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(50, 187, 79, 0.95),
        rgba(40, 146, 62, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(40, 167, 69, 0.6),
        rgba(30, 126, 52, 0.6)
      ) !important;
    }
  `,
  secondary: css`
    background: linear-gradient(
      135deg,
      rgba(108, 117, 125, 0.9),
      rgba(84, 91, 98, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(128, 137, 145, 0.95),
        rgba(104, 111, 118, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(108, 117, 125, 0.6),
        rgba(84, 91, 98, 0.6)
      ) !important;
    }
  `,
  danger: css`
    background: linear-gradient(
      135deg,
      rgba(220, 53, 69, 0.9),
      rgba(189, 33, 48, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(240, 73, 89, 0.95),
        rgba(209, 53, 68, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(220, 53, 69, 0.6),
        rgba(189, 33, 48, 0.6)
      ) !important;
    }
  `,
};

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
}: SubtitleEditorProps) {
  // --- Text Splitting Logic ---
  let originalText = '';
  let initialEditableText = sub.text;
  const hasMarker = sub.text.includes('###TRANSLATION_MARKER###');

  if (hasMarker) {
    const parts = sub.text.split('###TRANSLATION_MARKER###');
    originalText = parts[0] || '';
    initialEditableText = parts[1] || '';
  }
  // --- End Text Splitting Logic ---

  // --- Local State and Debounce ---
  const [currentText, setCurrentText] = useState(initialEditableText);

  // Update local state if the prop changes externally
  useEffect(() => {
    let newInitialEditableText = sub.text;
    if (sub.text.includes('###TRANSLATION_MARKER###')) {
      const parts = sub.text.split('###TRANSLATION_MARKER###');
      newInitialEditableText = parts[1] || '';
    }
    // Only update if the derived initial text actually differs from current state
    // to prevent resetting while typing if parent re-renders for other reasons.
    if (newInitialEditableText !== currentText) {
      setCurrentText(newInitialEditableText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub?.text]);

  // Ref to store the debounced function
  const debouncedUpdateParent = useRef(
    debounce((newFullText: string) => {
      onEditSubtitle(index, 'text', newFullText);
    }, DEBOUNCE_DELAY_MS)
  ).current;

  // Handle local text changes
  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newEditableText = e.target.value;
      // Update local state immediately for smooth typing
      setCurrentText(newEditableText);

      // Reconstruct the full text for the debounced update
      const fullText = hasMarker
        ? `${originalText}###TRANSLATION_MARKER###${newEditableText}`
        : newEditableText;

      // Trigger the debounced update to the parent
      debouncedUpdateParent(fullText);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, hasMarker, originalText, debouncedUpdateParent]
  );

  // --- End Local State and Debounce ---

  return (
    <div
      className={css`
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 15px;
        border-radius: 6px;
        border: 1px solid rgba(222, 226, 230, 0.7);
        background-color: rgba(248, 249, 250, 0.5);
        transition: all 0.2s ease;
        &:hover {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
          background-color: rgba(248, 249, 250, 0.8);
        }
      `}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ fontWeight: 'bold' }}>#{sub.index}</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            onClick={() => onRemoveSubtitle(index)}
            size="sm"
            variant="danger"
            title="Remove this subtitle"
            className={`${buttonGradientStyles.base} ${buttonGradientStyles.danger}`}
          >
            Delete
          </Button>
          <Button
            onClick={() => onInsertSubtitle(index)}
            size="sm"
            variant="primary"
            title="Insert a new subtitle after this one"
            className={`${buttonGradientStyles.base} ${buttonGradientStyles.primary}`}
          >
            Insert
          </Button>
        </div>
      </div>

      <div>
        {/* Display Original Text if present */}
        {hasMarker && (
          <div
            className={css`
              margin-bottom: 8px;
              padding: 8px;
              background-color: rgba(233, 236, 239, 0.6); // Lighter gray
              border-radius: 4px;
              border: 1px dashed rgba(206, 212, 218, 0.7);
              font-family: monospace;
              font-size: 0.95em;
              color: #495057; // Darker gray for text
              white-space: pre-wrap; // Preserve line breaks
              cursor: default; // Indicate read-only
            `}
          >
            <strong style={{ color: '#6c757d', fontSize: '0.9em' }}>
              Original:{' '}
            </strong>
            {originalText}
          </div>
        )}

        {/* Editable Text Area */}
        <textarea
          value={currentText}
          onChange={handleTextChange}
          style={textInputStyles}
          placeholder={
            hasMarker ? 'Enter reviewed/translated text' : 'Enter subtitle text'
          }
          id={`subtitle-${index}-text`}
        />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <label style={{ marginRight: 5, fontWeight: 500 }}>Start:</label>
          <input
            type="text"
            value={
              editingTimes[`${index}-start`] ?? secondsToSrtTime(sub.start)
            }
            onChange={e => onEditSubtitle(index, 'start', e.target.value)}
            onBlur={() => onTimeInputBlur(index, 'start')}
            className={timeInputStyles}
            id={`subtitle-${index}-start`}
          />
        </div>
        <div>
          <label style={{ marginRight: 5, fontWeight: 500 }}>End:</label>
          <input
            type="text"
            value={editingTimes[`${index}-end`] ?? secondsToSrtTime(sub.end)}
            onChange={e => onEditSubtitle(index, 'end', e.target.value)}
            onBlur={() => onTimeInputBlur(index, 'end')}
            className={timeInputStyles}
            id={`subtitle-${index}-end`}
          />
        </div>

        {/* Add Shift Buttons */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button
            onClick={() => onShiftSubtitle(index, -0.1)}
            size="sm"
            variant="secondary"
            title="Shift backward by 0.1 second"
            style={{ padding: '2px 5px', minWidth: '30px' }}
            className="shift-button"
            disabled={isShiftingDisabled}
          >
            -0.1s
          </Button>
          <Button
            onClick={() => onShiftSubtitle(index, -0.5)}
            size="sm"
            variant="secondary"
            title="Shift backward by 0.5 second"
            style={{ padding: '2px 5px', minWidth: '30px' }}
            className="shift-button"
            disabled={isShiftingDisabled}
          >
            -0.5s
          </Button>
          <Button
            onClick={() => onShiftSubtitle(index, 0.1)}
            size="sm"
            variant="secondary"
            title="Shift forward by 0.1 second"
            style={{ padding: '2px 5px', minWidth: '30px' }}
            className="shift-button"
            disabled={isShiftingDisabled}
          >
            +0.1s
          </Button>
          <Button
            onClick={() => onShiftSubtitle(index, 0.5)}
            size="sm"
            variant="secondary"
            title="Shift forward by 0.5 second"
            style={{ padding: '2px 5px', minWidth: '30px' }}
            className="shift-button"
            disabled={isShiftingDisabled}
          >
            +0.5s
          </Button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            onClick={() => onSeekToSubtitle(sub.start)}
            size="sm"
            variant="secondary"
            title="Move playhead to this subtitle's start time"
          >
            Seek
          </Button>
          <Button
            onClick={() => {
              // Use the onPlaySubtitle handler which will handle play/pause states
              onPlaySubtitle(sub.start, sub.end);
            }}
            size="sm"
            variant={isPlaying ? 'danger' : 'primary'}
            style={{ minWidth: '60px' }}
            title={isPlaying ? 'Pause playback' : 'Play this subtitle segment'}
            className={`${buttonGradientStyles.base} ${
              isPlaying
                ? buttonGradientStyles.danger
                : buttonGradientStyles.primary
            }`}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </Button>
        </div>
      </div>
    </div>
  );
}

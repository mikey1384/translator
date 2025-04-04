import { useState } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles';
import Button from '../../components/Button';
import { openSubtitleWithElectron } from '../../helpers';
import { SrtSegment } from '../../../types/interface';

interface TimestampDisplayProps {
  onChangeVideo?: (file: File) => void;
  hasSubtitles?: boolean;
  onShiftAllSubtitles?: (offsetSeconds: number) => void;
  onScrollToCurrentSubtitle?: () => void;
  onSrtLoaded: (segments: SrtSegment[]) => void;
  onUiInteraction?: () => void;
}

// Simple input style similar to time inputs in editor - Updated for Dark Theme
const shiftInputStyles = css`
  width: 80px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid ${colors.border};
  background-color: ${colors.light};
  color: ${colors.dark};
  font-family: monospace;
  text-align: right;
  margin-right: 5px;
  transition: border-color 0.2s ease;
  &:focus {
    outline: none;
    border-color: ${colors.primary};
  }
`;

export function TimestampDisplay({
  onChangeVideo,
  hasSubtitles = false,
  onShiftAllSubtitles,
  onScrollToCurrentSubtitle,
  onSrtLoaded,
  onUiInteraction,
}: TimestampDisplayProps) {
  // State for the shift input field
  const [shiftAmount, setShiftAmount] = useState<string>('0');

  // Determine visibility of optional sections
  const shouldShowScrollButton = onScrollToCurrentSubtitle && hasSubtitles;
  const shouldShowShiftControls = onShiftAllSubtitles && hasSubtitles;
  const onlyTopButtonsBlockVisible =
    !shouldShowScrollButton && !shouldShowShiftControls;

  // Handlers for video/srt buttons
  const handleVideoChangeClick = async () => {
    if (!window.electron?.openFile) {
      console.error('Electron openFile API is not available.');
      // Optionally show an error message to the user
      return;
    }
    try {
      const result = await window.electron.openFile({
        filters: [
          {
            name: 'Video Files',
            extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'],
          },
        ],
        title: 'Select Video File',
      });

      if (result.canceled || !result.filePaths?.length) {
        console.log('Video selection cancelled.');
        return;
      }

      const filePath = result.filePaths[0];
      console.log('Selected video file path:', filePath);

      // We need to create a File object to maintain compatibility with existing logic
      // that expects a File object (even though we now prioritize the path).
      // Electron doesn't directly give us a File object, so we might need
      // to read the file content if the downstream logic strictly requires it,
      // OR adjust downstream logic to prioritize the path.
      // For now, let's try sending just the path and see if App/EditSubtitles can handle it.
      // If not, we might need to read content here or adjust App.
      // A simple File object can be constructed if needed:
      // const file = new File([], path.basename(filePath)); // Placeholder content

      // For now, pass an object containing the path.
      // The receiving component (App.tsx) needs to be updated to handle this shape.
      if (onChangeVideo) {
        // Construct a pseudo-File object or a simple object with the path
        const fileData = {
          name: filePath.split(/[\\/]/).pop() || 'video.mp4', // Extract filename
          path: filePath,
          // We might need size later, could potentially get it via main process fs call if needed
          size: 0, // Placeholder
          type: '', // Placeholder - could try to infer from extension
        };
        onChangeVideo(fileData as any); // Use 'as any' for now, update type later
        onUiInteraction?.();
      }
    } catch (error) {
      console.error('Error opening video file with Electron:', error);
      // Optionally show an error message to the user
    }
  };

  const handleSrtLoad = async () => {
    try {
      const result = await openSubtitleWithElectron();
      if (result.segments) {
        onSrtLoaded(result.segments);
      } else if (result.error && !result.error.includes('canceled')) {
        console.error('Error loading SRT:', result.error);
        // Consider showing an error message to the user
      }
      onUiInteraction?.();
    } catch (err) {
      console.error('Failed to load SRT file:', err);
    }
  };

  // Handler for applying the shift
  const handleApplyShift = () => {
    const offset = parseFloat(shiftAmount);
    if (onShiftAllSubtitles && !isNaN(offset) && offset !== 0) {
      onShiftAllSubtitles(offset);
      // Optional: Reset input after applying, or leave it
      // setShiftAmount('0');
    }
  };

  // Simplified component with only the necessary buttons
  return (
    <div
      className={css`
        display: flex;
        height: 100%;
        width: 100%;
        box-sizing: border-box;
        font-family:
          'system-ui',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        color: ${colors.dark};
        border-radius: 8px;
        font-size: 14px;
        flex-direction: column;
        padding: 10px;
        gap: 10px;
        height: 100%;
        overflow-y: auto;
      `}
    >
      {/* Video, SRT Buttons */}
      <div
        className={css`
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          ${onlyTopButtonsBlockVisible ? 'margin-top: auto;' : ''}
        `}
      >
        {onChangeVideo && (
          <Button
            onClick={handleVideoChangeClick}
            variant="secondary"
            size="sm"
            title="Load a different video file"
            className={css`
              width: 100%;
              justify-content: flex-start;
              padding: 8px 12px;
            `}
          >
            <div
              className={css`
                display: inline-flex;
                align-items: center;
                gap: 6px;
              `}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>Change Video</span>
            </div>
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSrtLoad}
          title={
            hasSubtitles ? 'Load a different SRT file' : 'Load an SRT file'
          }
          className={css`
            width: 100%;
            justify-content: flex-start;
            padding: 8px 12px;
          `}
        >
          <div
            className={css`
              display: inline-flex;
              align-items: center;
              gap: 6px;
            `}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <span>{hasSubtitles ? 'Change SRT' : 'Add SRT'}</span>
          </div>
        </Button>
      </div>

      {/* Scroll to Current Button */}
      {shouldShowScrollButton && (
        <Button
          onClick={() => {
            // Call onUiInteraction first to ignore upcoming scroll events
            if (onUiInteraction) onUiInteraction();
            // Then scroll to current subtitle
            onScrollToCurrentSubtitle();
          }}
          title="Scroll to current subtitle"
          size="sm"
          variant="secondary"
          className={css`
            width: 100%;
            justify-content: flex-start;
            padding: 8px 12px;
          `}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          <span
            className={css`
              margin-left: 6px;
            `}
          >
            Scroll to Current
          </span>
        </Button>
      )}

      {/* Shift Controls */}
      {shouldShowShiftControls && (
        <div
          className={css`
            display: flex;
            align-items: center;
            width: 100%;
            margin-top: auto; /* Push to bottom */
          `}
        >
          <input
            type="number"
            value={shiftAmount}
            onChange={e => setShiftAmount(e.target.value)}
            onBlur={handleApplyShift}
            onKeyDown={e => e.key === 'Enter' && handleApplyShift()}
            className={shiftInputStyles}
            step="0.1"
            placeholder="Shift (s)"
            title="Shift all subtitles by seconds (+/-)"
          />
          <Button
            onClick={handleApplyShift}
            size="sm"
            variant="secondary"
            title="Apply subtitle shift"
            style={{ flexGrow: 1 }}
          >
            Apply Shift
          </Button>
        </div>
      )}
    </div>
  );
}

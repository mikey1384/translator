import { RefObject } from 'react';
import { css } from '@emotion/css';
import SubtitleItem from './SubtitleItem.js';
import { SrtSegment } from '../../../types/interface.js';

export interface SubtitleListProps {
  subtitles: SrtSegment[];
  showOriginalText: boolean;
  subtitleRefs: RefObject<(HTMLDivElement | null)[]>;
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
  onSeekToSubtitle: (time: number) => void;
  onPlaySubtitle: (startTime: number, endTime: number) => void;
  onShiftSubtitle: (index: number, shiftSeconds: number) => void;
  isShiftingDisabled: boolean;
  searchText: string;
  forcedIndex: number | null;
}

function SubtitleList({
  subtitles,
  subtitleRefs,
  showOriginalText,
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
  forcedIndex,
}: SubtitleListProps) {
  return (
    <div
      className={`subtitle-editor-container ${css`
        display: flex;
        flex-direction: column;
        gap: 15px;
        margin-bottom: 80px; // Keep bottom margin for fixed action bar

        .highlight-subtitle {
          animation: highlight-pulse 2s ease-in-out;
        }

        @keyframes highlight-pulse {
          0% {
            background-color: rgba(255, 215, 0, 0.6);
            transform: scale(1.01);
            box-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
          }
          30% {
            background-color: rgba(255, 215, 0, 0.4);
            transform: scale(1.005);
            box-shadow: 0 0 5px rgba(255, 215, 0, 0.3);
          }
          70% {
            background-color: rgba(255, 215, 0, 0.2);
            transform: scale(1);
            box-shadow: 0 0 3px rgba(255, 215, 0, 0.1);
          }
          100% {
            background-color: transparent;
            transform: scale(1);
            box-shadow: none;
          }
        }
      `}`}
    >
      {subtitles.map((sub, index) => (
        <div
          key={`${sub.index}-${sub.start}-${sub.text.slice(0, 10)}`}
          ref={el => {
            if (subtitleRefs && subtitleRefs?.current) {
              subtitleRefs.current[index] = el;
            }
          }}
          id={`subtitle-item-${index}`}
          className={css`
            scroll-margin-top: 10px;
          `}
        >
          <SubtitleItem
            sub={sub}
            index={index}
            editingTimes={editingTimes}
            isPlaying={isPlaying}
            secondsToSrtTime={secondsToSrtTime}
            showOriginalText={showOriginalText}
            onEditSubtitle={onEditSubtitle}
            onTimeInputBlur={onTimeInputBlur}
            onRemoveSubtitle={onRemoveSubtitle}
            onInsertSubtitle={onInsertSubtitle}
            onSeekToSubtitle={onSeekToSubtitle}
            onPlaySubtitle={onPlaySubtitle}
            onShiftSubtitle={onShiftSubtitle}
            isShiftingDisabled={isShiftingDisabled}
            searchText={searchText}
            forcedIndex={forcedIndex}
          />
        </div>
      ))}
    </div>
  );
}

export default SubtitleList;

import React from 'react';
import { css } from '@emotion/css';
import LazySubtitleItem from './LazySubtitleItem';
import { SrtSegment } from '../../../types/interface';

interface SubtitleListProps {
  subtitles: SrtSegment[];
  subtitleRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
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
}

function SubtitleList({
  subtitles,
  subtitleRefs,
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
          key={`${sub.index}-${sub.start}-${sub.end}`}
          ref={el => {
            subtitleRefs.current[index] = el;
          }}
        >
          <LazySubtitleItem
            key={sub.index}
            sub={sub}
            index={index}
            editingTimes={editingTimes}
            isPlaying={isPlaying}
            secondsToSrtTime={secondsToSrtTime}
            onEditSubtitle={onEditSubtitle}
            onTimeInputBlur={onTimeInputBlur}
            onRemoveSubtitle={onRemoveSubtitle}
            onInsertSubtitle={onInsertSubtitle}
            onSeekToSubtitle={onSeekToSubtitle}
            onPlaySubtitle={onPlaySubtitle}
            onShiftSubtitle={onShiftSubtitle}
            isShiftingDisabled={isShiftingDisabled}
          />
        </div>
      ))}
    </div>
  );
}

export default SubtitleList;

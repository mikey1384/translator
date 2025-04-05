import { useRef, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { SrtSegment } from '../../../types/interface.js';
import SubtitleEditor from './SubtitleEditor.js';
import { useLazyLoad } from './hooks/useLazyLoad.js';
import { css } from '@emotion/css';

interface LazySubtitleItemProps {
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
  onSeekToSubtitle: (time: number) => void;
  onPlaySubtitle: (startTime: number, endTime: number) => void;
  onShiftSubtitle: (index: number, shiftSeconds: number) => void;
  isShiftingDisabled: boolean;
}

function LazySubtitleItem({
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
}: LazySubtitleItemProps) {
  const [ComponentRef, inView] = useInView();

  // State to control visibility after scrolling away
  const [isVisible, setIsVisible] = useState(false);
  const [placeholderHeight, setPlaceholderHeight] = useState(150); // Default height
  const itemRef = useRef<HTMLDivElement>(null);

  // Use our lazy loading hook
  useLazyLoad({
    itemRef,
    inView,
    onSetIsVisible: setIsVisible,
    onSetPlaceholderHeight: setPlaceholderHeight,
    delay: 500, // Keep rendered for 500ms after scrolling away
  });

  const shouldRender = isVisible || inView;

  return (
    <div
      ref={ComponentRef}
      className={css`
        margin-bottom: 15px;
        min-height: ${placeholderHeight}px;
      `}
    >
      {shouldRender ? (
        <div ref={itemRef}>
          <SubtitleEditor
            key={`${sub.index}-${sub.start}-${sub.end}`}
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
      ) : (
        // Placeholder with the same height as the content
        <div
          className={css`
            height: ${placeholderHeight}px;
            background-color: rgba(0, 0, 0, 0.03);
            border-radius: 8px;
            border: 1px solid rgba(0, 0, 0, 0.1);
          `}
        />
      )}
    </div>
  );
}

export default LazySubtitleItem;

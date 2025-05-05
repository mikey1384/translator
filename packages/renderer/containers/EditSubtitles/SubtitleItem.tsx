import { useRef, useState, forwardRef } from 'react';
import { useInView } from 'react-intersection-observer';
import { mergeRefs } from 'react-merge-refs';
import SubtitleEditor from './SubtitleEditor.js';
import { useLazyLoad } from './hooks/useLazyLoad.js';
import { css } from '@emotion/css';
import { useSubtitleRow } from '../../state/subtitle-store';

interface SubtitleItemProps {
  id: string;
  searchText?: string;
  forcedId?: string | null;
}

const SubtitleItem = forwardRef<HTMLDivElement, SubtitleItemProps>(
  ({ id, searchText, forcedId }, parentRef) => {
    const shouldForceRender = forcedId === id;
    const [ComponentRef, inView] = useInView();

    const { subtitle: subtitleFromStore } = useSubtitleRow(id);
    const activeSub = subtitleFromStore;

    const [isVisible, setIsVisible] = useState(false);
    const [placeholderHeight, setPlaceholderHeight] = useState(150);
    const itemRef = useRef<HTMLDivElement>(null);

    useLazyLoad({
      itemRef,
      inView,
      onSetIsVisible: setIsVisible,
      onSetPlaceholderHeight: setPlaceholderHeight,
      delay: 500,
    });

    if (!activeSub) {
      return null;
    }

    const shouldRender = shouldForceRender || isVisible || inView;

    return (
      <div
        ref={mergeRefs([parentRef, ComponentRef])}
        className={css`
          margin-bottom: 15px;
          min-height: ${placeholderHeight}px;
        `}
      >
        {shouldRender ? (
          <div ref={itemRef} className="subtitle-editor-content-wrapper">
            <SubtitleEditor id={activeSub.id} searchText={searchText} />
          </div>
        ) : (
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
);

SubtitleItem.displayName = 'SubtitleItem';

export default SubtitleItem;

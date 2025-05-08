import React, { forwardRef, useState, useEffect } from 'react';
import { css } from '@emotion/css';
import { useInView } from 'react-intersection-observer';
import SubtitleEditor from './SubtitleEditor/index.js';
import {
  useSubtitleRow,
  useSubActions,
} from '../../../../state/subtitle-store.js';

interface Props {
  id: string;
  searchText?: string;
  isAffected: boolean;
}

const SubtitleItemComponent = forwardRef<HTMLDivElement, Props>(
  ({ id, searchText = '', isAffected }, outerRef) => {
    const { subtitle: seg } = useSubtitleRow(id);
    const { update: updateSubtitle } = useSubActions();
    const [ref, inView] = useInView({
      rootMargin: '50% 0px',
      triggerOnce: false,
    });

    const [showNew, setShowNew] = useState(!isAffected);

    useEffect(() => {
      let timeoutId: NodeJS.Timeout | null = null;
      if (isAffected) {
        setShowNew(false);
        timeoutId = setTimeout(() => {
          setShowNew(true);
          if (seg?._oldText !== undefined) {
            console.log(`[SubtitleItem ${id}] Clearing _oldText`);
            updateSubtitle(id, { _oldText: undefined });
          }
        }, 300);
      } else {
        setShowNew(true);
      }

      return () => {
        if (timeoutId) clearTimeout(timeoutId);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAffected]);

    const shouldRender = inView;

    const combinedRef = (node: HTMLDivElement | null) => {
      ref(node);
      if (typeof outerRef === 'function') {
        outerRef(node);
      } else if (outerRef) {
        outerRef.current = node;
      }
    };

    return (
      <div
        ref={combinedRef}
        data-cue-id={id}
        className={css`
          box-sizing: border-box;
        `}
      >
        {shouldRender && (
          <SubtitleEditor
            id={id}
            searchText={searchText}
            temporaryAffectedText={
              isAffected && !showNew ? seg?._oldText : undefined
            }
          />
        )}
        {!shouldRender && (
          <div
            className={css`
              height: 150px;
            `}
          ></div>
        )}
      </div>
    );
  }
);

SubtitleItemComponent.displayName = 'SubtitleItem';
export default React.memo(SubtitleItemComponent);

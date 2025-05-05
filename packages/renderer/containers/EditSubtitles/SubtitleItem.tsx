import React, { forwardRef, useState } from 'react';
import { css } from '@emotion/css';
import { useInView } from 'react-intersection-observer';
import SubtitleEditor from './SubtitleEditor.js';

interface Props {
  id: string;
  searchText?: string;
}

const SubtitleItemComponent = forwardRef<HTMLDivElement, Props>(
  ({ id, searchText = '' }, outerRef) => {
    const [ref, inView] = useInView({
      rootMargin: '50% 0px',
      triggerOnce: false,
    });

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
        className={css`
          box-sizing: border-box;
        `}
      >
        {shouldRender && <SubtitleEditor id={id} searchText={searchText} />}
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

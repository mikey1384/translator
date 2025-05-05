import React, { forwardRef } from 'react';
import { css } from '@emotion/css';
import SubtitleEditor from './SubtitleEditor.js';
import { useSubtitleRow } from '../../state/subtitle-store';

interface Props {
  id: string;
  searchText?: string;
}

const SubtitleItem = forwardRef<HTMLDivElement, Props>(
  ({ id, searchText }, ref) => {
    const { subtitle } = useSubtitleRow(id);
    if (!subtitle) return null;

    return (
      <div
        ref={ref}
        className={css`
          padding-bottom: 15px; /* matches the old gap */
        `}
      >
        <SubtitleEditor id={id} searchText={searchText} />
      </div>
    );
  }
);

SubtitleItem.displayName = 'SubtitleItem';
export default React.memo(SubtitleItem);

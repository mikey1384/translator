import { useMemo, RefObject } from 'react';
import { css } from '@emotion/css';
import SubtitleItem from './SubtitleItem/index.js';
import { useSubStore } from '../../../state/subtitle-store.js';

interface Props {
  searchText?: string;
  subtitleRefs: RefObject<Record<string, HTMLDivElement | null>>;
  affectedRows: number[];
}

export default function SubtitleList({
  searchText = '',
  subtitleRefs,
  affectedRows,
}: Props) {
  const { order } = useSubStore(s => ({ order: s.order })); // IDs only

  const setRowRef = useMemo(() => {
    const map: Record<string, (el: HTMLDivElement | null) => void> = {};
    order.forEach(id => {
      map[id] = el => {
        if (subtitleRefs.current) {
          subtitleRefs.current[id] = el;
        }
      };
    });
    return map;
  }, [order, subtitleRefs]);

  return (
    <div
      className={css`
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding-bottom: 90px;
      `}
    >
      {order.map((id, idx) => (
        <SubtitleItem
          key={id}
          id={id}
          searchText={searchText}
          ref={setRowRef[id]}
          isAffected={affectedRows.includes(idx)}
        />
      ))}
    </div>
  );
}

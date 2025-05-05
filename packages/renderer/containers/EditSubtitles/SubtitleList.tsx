import { useRef, useMemo } from 'react';
import { css } from '@emotion/css';
import SubtitleItem from './SubtitleItem.js';
import { useSubStore } from '../../state/subtitle-store';

interface Props {
  searchText?: string;
}

export default function SubtitleList({ searchText = '' }: Props) {
  const { order } = useSubStore(s => ({ order: s.order })); // IDs only
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  const setRowRef = useMemo(() => {
    const map: Record<string, (el: HTMLDivElement | null) => void> = {};
    order.forEach(id => {
      map[id] = el => (refs.current[id] = el);
    });
    return map;
  }, [order]);

  return (
    <div
      className={css`
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding-bottom: 90px;
      `}
    >
      {order.map(id => (
        <SubtitleItem
          key={id}
          id={id}
          searchText={searchText}
          ref={setRowRef[id]} // Pass stable ref setter
        />
      ))}
    </div>
  );
}

import { useMemo, RefObject } from 'react';
import SubtitleItem from './SubtitleItem/index.js';
import { useSubStore } from '../../../state/subtitle-store.js';
import { editorListStackStyles } from '../edit-workspace-styles';

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
  const order = useSubStore(s => s.order);
  const affectedRowSet = useMemo(() => new Set(affectedRows), [affectedRows]);

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
    <div className={editorListStackStyles}>
      {order.map((id, idx) => (
        <SubtitleItem
          key={id}
          id={id}
          searchText={searchText}
          ref={setRowRef[id]}
          isAffected={affectedRowSet.has(idx)}
        />
      ))}
    </div>
  );
}

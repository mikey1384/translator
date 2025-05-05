import { useRef } from 'react';
import SubtitleItem from './SubtitleItem.js';
import { useSubStore } from '../../state/subtitle-store';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { shallow } from 'zustand/shallow';

interface Props {
  searchText?: string;
}

function SubtitleList({ searchText }: Props) {
  const { order, segments } = useSubStore(
    s => ({ order: s.order, segments: s.segments }),
    shallow
  );
  const subtitleRefs = useRef<Record<string, HTMLDivElement | null>>({});

  return (
    <List
      height={window.innerHeight - 120}
      itemCount={order.length}
      itemSize={190}
      width="100%"
      overscanCount={4}
    >
      {({ index, style }: ListChildComponentProps) => {
        const id = order[index];
        const sub = segments[id];
        if (!sub) return null;
        return (
          <div
            key={sub.id}
            style={style}
            ref={(el: HTMLDivElement | null) => {
              if (subtitleRefs.current) {
                subtitleRefs.current[sub.id] = el;
              }
            }}
          >
            <SubtitleItem id={sub.id} searchText={searchText} />
          </div>
        );
      }}
    </List>
  );
}

export default SubtitleList;

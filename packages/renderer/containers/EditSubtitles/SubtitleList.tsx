import { RefObject } from 'react';
import { css } from '@emotion/css';
import SubtitleItem from './SubtitleItem.js';
import { useSubStore } from '../../state/subtitle-store';

interface Props {
  subtitleRefs: RefObject<Record<string, HTMLDivElement | null>>;
  searchText?: string;
  forcedId?: string | null;
}

const containerStyles = css`
  display: flex;
  flex-direction: column;
  gap: 15px;
  margin-bottom: 80px;

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
`;

function SubtitleList({ subtitleRefs, searchText, forcedId }: Props) {
  const subtitles = useSubStore(s => s.segments); // single selector keeps it simple

  return (
    <div className={`subtitle-editor-container ${containerStyles}`}>
      {subtitles.map(sub => (
        <SubtitleItem
          key={sub.id}
          id={sub.id}
          searchText={searchText}
          forcedId={forcedId ?? null}
          ref={(el: HTMLDivElement | null) => {
            subtitleRefs.current[sub.id] = el;
          }}
        />
      ))}
    </div>
  );
}

export default SubtitleList;

import type { SrtSegment } from '@shared-types/app';
import { formatTimestampForSegment } from './helpers';
import type { LanguageKey } from './types';
import {
  segmentRowStyles,
  segmentTextStyles,
  segmentTimeStyles,
  transcriptListStyles,
} from './styles';

interface TranscriptListProps {
  segments: SrtSegment[];
  selectedLanguage: LanguageKey | null;
}

const resolveSegmentText = (
  segment: SrtSegment,
  selectedLanguage: LanguageKey | null
) => {
  if (selectedLanguage === 'transcript') {
    return segment.original;
  }

  if (selectedLanguage && segment.translation) {
    return segment.translation;
  }

  return segment.original;
};

export default function TranscriptList({
  segments,
  selectedLanguage,
}: TranscriptListProps) {
  return (
    <div className={transcriptListStyles}>
      {segments.map(segment => {
        const start = formatTimestampForSegment(segment.start);
        const end = formatTimestampForSegment(segment.end);
        const text = resolveSegmentText(segment, selectedLanguage) || '—';

        return (
          <div key={segment.id} className={segmentRowStyles}>
            <span className={segmentTimeStyles}>
              {start} → {end}
            </span>
            <span className={segmentTextStyles}>{text}</span>
          </div>
        );
      })}
    </div>
  );
}

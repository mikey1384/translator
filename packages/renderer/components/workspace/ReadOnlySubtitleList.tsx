import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSubStore } from '../../state';
import { getNativePlayerInstance } from '../../native-player';
import {
  readEmptyStyles,
  readListStyles,
  readOriginalStyles,
  readRowStyles,
  readTimeStyles,
  readTranslationStyles,
} from './workspace-styles';

// Cues revealed with a staggered entrance when a whole transcript lands at
// once; beyond this the rest appear without delay.
const CASCADE_LIMIT = 40;
const CASCADE_STEP_MS = 28;

function formatCueTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Index of the cue playing at `time`, or the last one started before it. */
export function findActiveCueIndex(
  starts: number[],
  ends: number[],
  time: number
): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return -1;
  return time <= ends[found] + 0.25 ? found : -1;
}

interface RowProps {
  id: string;
  index: number;
  start: number;
  original: string;
  translation: string;
  active: boolean;
  fresh: boolean;
  reveal: boolean;
  revealDelayMs: number;
  onSelect: (id: string) => void;
}

const ReadRow = memo(function ReadRow({
  id,
  start,
  original,
  translation,
  active,
  fresh,
  reveal,
  revealDelayMs,
  onSelect,
}: RowProps) {
  const hasTranslation = translation.trim().length > 0;
  return (
    <button
      type="button"
      className={readRowStyles}
      data-cue-id={id}
      data-active={active ? 'true' : 'false'}
      data-reveal={reveal ? 'true' : 'false'}
      style={reveal ? { animationDelay: `${revealDelayMs}ms` } : undefined}
      onClick={() => onSelect(id)}
      aria-current={active ? 'true' : undefined}
    >
      <span className={readTimeStyles}>{formatCueTime(start)}</span>
      <span>
        <span className={readOriginalStyles(hasTranslation)}>{original}</span>
        {hasTranslation ? (
          <span
            // A new key replays the flip when this line's translation changes.
            key={fresh ? `fresh-${translation}` : 'stable'}
            className={readTranslationStyles}
            data-fresh={fresh ? 'true' : 'false'}
            style={{ display: 'block' }}
          >
            {translation}
          </span>
        ) : null}
      </span>
    </button>
  );
});

export default function ReadOnlySubtitleList() {
  const { t } = useTranslation();
  const order = useSubStore(s => s.order);
  const segments = useSubStore(s => s.segments);
  const seek = useSubStore(s => s.seek);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const userScrolledAt = useRef(0);

  const rows = useMemo(
    () =>
      order
        .map(id => segments[id])
        .filter(Boolean)
        .map(cue => ({
          id: cue.id,
          start: cue.start,
          end: cue.end,
          original: cue.original ?? '',
          translation: cue.translation ?? '',
        })),
    [order, segments]
  );

  // Which lines just received (or changed) a translation since last render.
  const previousTranslations = useRef<Map<string, string>>(new Map());
  const freshIds = useMemo(() => {
    const prev = previousTranslations.current;
    const fresh = new Set<string>();
    const hadAny = prev.size > 0;
    for (const row of rows) {
      const before = prev.get(row.id);
      if (
        hadAny &&
        row.translation.trim() &&
        before !== undefined &&
        before !== row.translation
      ) {
        fresh.add(row.id);
      }
    }
    return fresh;
  }, [rows]);
  useEffect(() => {
    const next = new Map<string, string>();
    for (const row of rows) next.set(row.id, row.translation);
    previousTranslations.current = next;
  }, [rows]);

  // Cascade the reveal when the cue list goes from empty to a full transcript.
  const [revealBatch, setRevealBatch] = useState(false);
  const prevCount = useRef(0);
  useEffect(() => {
    const before = prevCount.current;
    prevCount.current = rows.length;
    if (before === 0 && rows.length > 0) {
      setRevealBatch(true);
      const timer = setTimeout(
        () => setRevealBatch(false),
        CASCADE_LIMIT * CASCADE_STEP_MS + 600
      );
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [rows.length]);

  // Follow playback.
  const starts = useMemo(() => rows.map(r => r.start), [rows]);
  const ends = useMemo(() => rows.map(r => r.end), [rows]);
  useEffect(() => {
    let detach: (() => void) | undefined;
    const attach = () => {
      detach?.();
      const video = getNativePlayerInstance();
      if (!video) return;
      const onTime = () =>
        setActiveIndex(findActiveCueIndex(starts, ends, video.currentTime));
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('seeked', onTime);
      onTime();
      detach = () => {
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('seeked', onTime);
      };
    };
    attach();
    window.addEventListener('native-player-ready', attach);
    return () => {
      window.removeEventListener('native-player-ready', attach);
      detach?.();
    };
  }, [starts, ends]);

  // Keep the playing line in view unless the user is reading elsewhere.
  useEffect(() => {
    if (activeIndex < 0) return;
    if (Date.now() - userScrolledAt.current < 4000) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(
      `[data-cue-id="${rows[activeIndex]?.id}"]`
    );
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    if (
      top < list.scrollTop ||
      top + row.offsetHeight > list.scrollTop + list.clientHeight
    ) {
      list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3) });
    }
  }, [activeIndex, rows]);

  const select = useMemo(
    () => (id: string) => {
      userScrolledAt.current = 0;
      seek(id);
    },
    [seek]
  );

  if (rows.length === 0) {
    return (
      <div className={readEmptyStyles}>
        {t(
          'workspace.emptyList',
          'Subtitles appear here as soon as Translator has listened to the video.'
        )}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className={readListStyles}
      onWheel={() => (userScrolledAt.current = Date.now())}
      onTouchMove={() => (userScrolledAt.current = Date.now())}
      aria-label={t('workspace.subtitlesTitle', 'Subtitles')}
    >
      {rows.map((row, index) => (
        <ReadRow
          key={row.id}
          id={row.id}
          index={index}
          start={row.start}
          original={row.original}
          translation={row.translation}
          active={index === activeIndex}
          fresh={freshIds.has(row.id)}
          reveal={revealBatch && index < CASCADE_LIMIT}
          revealDelayMs={index * CASCADE_STEP_MS}
          onSelect={select}
        />
      ))}
    </div>
  );
}

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/css';
import { useSubStore, useUIStore } from '../../state';
import { splitByMatches, useFindOptions } from '../../utils/subtitleFind';
import type { FindOptions } from '../../utils/subtitleFind';
import { colors } from '../../styles';
import { getNativePlayerInstance } from '../../native-player';
import { useWorkspaceActions } from '../../state/workspace-actions';
import { currentSubtitleIndex } from '../../utils/currentSubtitle';
import { flashSubtitle } from '../../utils/scroll';
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

const findMarkStyles = css`
  background: rgba(255, 216, 77, 0.28);
  color: inherit;
  border-radius: 3px;
  padding: 0 1px;
`;

const findActiveMarkStyles = css`
  background: ${colors.primary};
  color: ${colors.onPrimary};
`;

/** The text with every find match wrapped in a <mark>. */
function Highlighted({
  text,
  find,
}: {
  text: string;
  find: { term: string; options: FindOptions; active: boolean } | null;
}) {
  if (!find) return <>{text}</>;
  return (
    <>
      {splitByMatches(text, find.term, find.options).map((part, i) =>
        part.match ? (
          <mark
            key={i}
            className={
              find.active
                ? `${findMarkStyles} ${findActiveMarkStyles}`
                : findMarkStyles
            }
          >
            {part.text}
          </mark>
        ) : (
          part.text
        )
      )}
    </>
  );
}

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
  find: { term: string; options: FindOptions; active: boolean } | null;
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
  find,
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
      // Space plays/pauses (the player's window shortcut) instead of
      // clicking the line again, which would seek back to its start.
      onKeyUp={event => {
        if (event.key === ' ') event.preventDefault();
      }}
      aria-current={active ? 'true' : undefined}
    >
      <span className={readTimeStyles}>{formatCueTime(start)}</span>
      <span>
        <span className={readOriginalStyles(hasTranslation)} dir="auto">
          <Highlighted text={original} find={find} />
        </span>
        {hasTranslation ? (
          <span
            // A new key replays the flip when this line's translation changes.
            key={fresh ? `fresh-${translation}` : 'stable'}
            className={readTranslationStyles}
            dir="auto"
            data-fresh={fresh ? 'true' : 'false'}
            style={{ display: 'block' }}
          >
            <Highlighted text={translation} find={find} />
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
  const findVisible = useUIStore(s => s.isFindBarVisible);
  const searchText = useUIStore(s => s.searchText);
  const matchedIndices = useUIStore(s => s.matchedIndices);
  const activeMatchIndex = useUIStore(s => s.activeMatchIndex);
  const navTick = useUIStore(s => s.navTick);
  const matchCase = useFindOptions(s => s.matchCase);
  const wholeWord = useFindOptions(s => s.wholeWord);
  const findTerm = findVisible && searchText.trim() ? searchText : '';
  const findOptions = useMemo(
    () => ({ matchCase, wholeWord }),
    [matchCase, wholeWord]
  );
  const matchedSet = useMemo(
    () => new Set(findTerm ? matchedIndices : []),
    [findTerm, matchedIndices]
  );
  const activeMatchRow = findTerm
    ? (matchedIndices[activeMatchIndex] ?? -1)
    : -1;

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
  // Only a new playing line moves the list: translations streaming into a
  // paused video must not pull the reader back.
  const followedId = useRef<string | null>(null);
  const followTarget = useRef<{ top: number; until: number } | null>(null);
  const pointerHeld = useRef(false);
  const navigateToCurrent = useCallback(() => {
    const video = getNativePlayerInstance();
    if (!video) return;
    const index = currentSubtitleIndex(rows, video.currentTime);
    const list = listRef.current;
    const row = list?.children.item(index) as HTMLElement | null;
    if (!list || !row) return;
    useUIStore.getState().setFindBarVisible(false);
    userScrolledAt.current = 0;
    pointerHeld.current = false;
    followedId.current = rows[index]?.id ?? null;
    const target = Math.max(
      0,
      Math.min(
        list.scrollHeight - list.clientHeight,
        list.scrollTop +
          row.getBoundingClientRect().top -
          list.getBoundingClientRect().top -
          list.clientHeight / 3
      )
    );
    followTarget.current = { top: target, until: Date.now() + 1500 };
    list.scrollTo({ top: target, behavior: 'instant' });
    flashSubtitle(row);
  }, [rows]);
  useEffect(() => {
    useWorkspaceActions
      .getState()
      .registerSubtitleNavigation(navigateToCurrent);
    return () =>
      useWorkspaceActions.getState().registerSubtitleNavigation(null);
  }, [navigateToCurrent]);
  useEffect(() => {
    if (activeIndex < 0) return;
    const id = rows[activeIndex]?.id ?? null;
    if (!id || id === followedId.current) return;
    followedId.current = id;
    if (pointerHeld.current) return;
    if (Date.now() - userScrolledAt.current < 4000) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-cue-id="${id}"]`);
    if (!list || !row) return;
    // Measure against the list itself: offsetTop is relative to whichever
    // ancestor is positioned, which made every follow-scroll land off target.
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const top = rowRect.top - listRect.top;
    // Only move when the line leaves the comfortable middle of the list, then
    // bring it to the upper third so the next lines stay visible.
    if (top < 0 || top + rowRect.height > list.clientHeight * 0.8) {
      const target = Math.max(
        0,
        Math.min(
          list.scrollHeight - list.clientHeight,
          list.scrollTop + top - list.clientHeight / 3
        )
      );
      followTarget.current = { top: target, until: Date.now() + 1500 };
      list.scrollTo({ top: target });
    }
  }, [activeIndex, rows]);

  // Find next/previous brings the current match to the middle of the list
  // and holds off playback-following so it stays there while reading.
  useEffect(() => {
    if (activeMatchRow < 0) return;
    const id = rows[activeMatchRow]?.id;
    const list = listRef.current;
    const row = id
      ? list?.querySelector<HTMLElement>(`[data-cue-id="${id}"]`)
      : null;
    if (!list || !row) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const target = Math.max(
      0,
      Math.min(
        list.scrollHeight - list.clientHeight,
        list.scrollTop +
          rowRect.top -
          listRect.top -
          (list.clientHeight - rowRect.height) / 2
      )
    );
    followTarget.current = null;
    userScrolledAt.current = Date.now();
    list.scrollTo({ top: target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatchRow, navTick]);

  // Any scroll the list didn't make itself (wheel, scrollbar, keys,
  // find-in-page) means the user is reading.
  const onScroll = () => {
    const list = listRef.current;
    const ours = followTarget.current;
    if (list && ours && Date.now() < ours.until) {
      if (Math.abs(list.scrollTop - ours.top) <= 2) followTarget.current = null;
      return;
    }
    followTarget.current = null;
    userScrolledAt.current = Date.now();
  };
  useEffect(() => {
    const release = () => {
      if (!pointerHeld.current) return;
      pointerHeld.current = false;
      userScrolledAt.current = Date.now();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

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
      onScroll={onScroll}
      onWheel={() => {
        followTarget.current = null;
        userScrolledAt.current = Date.now();
      }}
      // Holding the scrollbar pauses following until it's released.
      onPointerDown={event => {
        // macOS overlay scrollbars have no width, so any press on the list
        // background (not a row) counts as holding the scrollbar.
        if (event.target === event.currentTarget) {
          pointerHeld.current = true;
          followTarget.current = null;
        }
      }}
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
          find={
            matchedSet.has(index)
              ? {
                  term: findTerm,
                  options: findOptions,
                  active: index === activeMatchRow,
                }
              : null
          }
        />
      ))}
    </div>
  );
}

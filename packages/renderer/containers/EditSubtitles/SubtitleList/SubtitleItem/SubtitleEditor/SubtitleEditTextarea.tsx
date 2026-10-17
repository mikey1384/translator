import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildFindRegex,
  useFindOptions,
} from '../../../../../utils/subtitleFind.js';
import { registerPendingEdit } from '../../../../../utils/pending-edits.js';
import {
  editorTextareaHighlightMatchStyles,
  editorTextareaHighlightStyles,
  editorTextareaInputStyles,
  editorTextareaLockedBadgeStyles,
  editorTextareaLockIconStyles,
  editorTextareaPlaceholderStyles,
  editorTextareaShellStyles,
} from '../../../edit-workspace-styles';

interface SubtitleEditTextareaProps {
  value: string;
  searchTerm: string;
  onChange: (newValue: string) => void;
  rows?: number;
  placeholder?: string;
  readOnly?: boolean;
}

export default function SubtitleEditTextarea({
  value,
  searchTerm,
  onChange,
  rows = 5,
  placeholder = '',
  readOnly = false,
}: SubtitleEditTextareaProps) {
  const { t } = useTranslation();
  const matchCase = useFindOptions(s => s.matchCase);
  const wholeWord = useFindOptions(s => s.wholeWord);
  const findOptions = { matchCase, wholeWord };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<NodeJS.Timeout | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const [localValue, setLocalValue] = useState<string>(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (!highlightRef.current || !textareaRef.current) return;
    highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
  }, [localValue, searchTerm]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // The typed text not yet committed to the store, and its flush registration
  // (so Save, export and closing the tab commit it first).
  const pendingRef = useRef<{ text: string; unregister: () => void } | null>(
    null
  );

  const flushPending = useCallback(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    pending.unregister();
    onChangeRef.current(pending.text);
  }, []);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (readOnly) return;
      const next = e.target.value;
      setLocalValue(next);
      if (pendingRef.current) {
        pendingRef.current.text = next;
      } else {
        pendingRef.current = {
          text: next,
          unregister: registerPendingEdit(flushPending),
        };
      }
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(flushPending, 200);
    },
    [flushPending, readOnly]
  );

  const handleBlur = useCallback(() => {
    // Final commit on blur so parent store stays in sync
    flushPending();
  }, [flushPending]);

  const handleScroll = useCallback(() => {
    if (!highlightRef?.current || !textareaRef?.current) return;
    highlightRef.current.scrollTop = textareaRef?.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef?.current.scrollLeft;
  }, []);

  const handleFocus = useCallback(() => {
    if (readOnly) return;
    // No-op; overlay reads from localValue directly
  }, [readOnly]);

  const handleKeyUp = useCallback(() => {
    if (readOnly) return;

    const cur = textareaRef.current?.value ?? '';
    if (cur.length === 0) {
      setLocalValue('');
    }
  }, [readOnly]);

  useEffect(() => {
    return () => {
      // A row can unmount (list virtualization, closing the editor) with a
      // keystroke still pending; commit it rather than drop it.
      flushPending();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [flushPending]);

  return (
    <div className={editorTextareaShellStyles(rows, readOnly)}>
      {readOnly && (
        <div className={editorTextareaLockedBadgeStyles} aria-hidden>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={editorTextareaLockIconStyles}
          >
            <rect x="5" y="11" width="14" height="8" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span>{t('common.locked', 'Locked')}</span>
        </div>
      )}
      <div
        ref={highlightRef}
        className={editorTextareaHighlightStyles(rows)}
        dir="auto"
      >
        {(() => {
          const raw = localValue ?? '';
          const re = buildFindRegex(searchTerm, findOptions);
          if (!raw && placeholder && !readOnly) {
            return (
              <span className={editorTextareaPlaceholderStyles}>
                {placeholder}
              </span>
            );
          }
          if (!re) return raw;
          const nodes: React.ReactNode[] = [];
          let last = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(raw)) !== null) {
            const start = m.index;
            const end = start + m[0].length;
            if (start > last) nodes.push(raw.slice(last, start));
            nodes.push(
              <span
                key={`h-${start}-${end}`}
                className={editorTextareaHighlightMatchStyles}
              >
                {raw.slice(start, end)}
              </span>
            );
            last = end;
            if (m.index === re.lastIndex) re.lastIndex++;
          }
          if (last < raw.length) nodes.push(raw.slice(last));
          return nodes;
        })()}
      </div>
      <textarea
        ref={textareaRef}
        dir="auto"
        className={editorTextareaInputStyles(rows, readOnly)}
        placeholder={placeholder}
        rows={rows}
        value={localValue}
        onChange={handleInput}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onKeyUp={handleKeyUp}
        onScroll={handleScroll}
        readOnly={readOnly}
        aria-readonly={readOnly}
        title={
          readOnly
            ? t('common.lockedWhileProcessing', 'Locked while processing')
            : undefined
        }
      />
    </div>
  );
}

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  const commit = useCallback((text: string) => onChange(text), [onChange]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (readOnly) return;
      const next = e.target.value;
      setLocalValue(next);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        commit(next);
      }, 200);
    },
    [commit, readOnly]
  );

  const handleBlur = useCallback(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
    }
    // Final commit on blur so parent store stays in sync
    commit(localValue);
  }, [commit, localValue]);

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
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

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
      <div ref={highlightRef} className={editorTextareaHighlightStyles(rows)}>
        {(() => {
          const raw = localValue ?? '';
          const buildRegex = (rawTerm: string): RegExp | null => {
            const trimmed = rawTerm.trim();
            if (!trimmed) return null;
            try {
              const pattern = escapeRegExp(trimmed).replace(/\s+/g, '\\s+');
              return new RegExp(pattern, 'gi');
            } catch {
              return null;
            }
          };
          const re = buildRegex(searchTerm);
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
              <span key={`h-${start}-${end}`} className={editorTextareaHighlightMatchStyles}>
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

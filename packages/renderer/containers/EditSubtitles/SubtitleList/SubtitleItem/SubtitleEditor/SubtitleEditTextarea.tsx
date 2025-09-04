import React, { useRef, useState, useCallback, useEffect } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../../../../styles.js';
import { useTranslation } from 'react-i18next';

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

function getHighlightedHtml(text: string, searchTerm: string): string {
  const buildRegex = (raw: string): RegExp | null => {
    const trimmedRaw = raw.trim();
    if (!trimmedRaw) return null;
    try {
      const pattern = escapeRegExp(trimmedRaw).replace(/\s+/g, '\\s+');
      return new RegExp(pattern, 'gi');
    } catch {
      return null;
    }
  };

  const regex = buildRegex(searchTerm);

  if (!regex) {
    return text.replace(/ /g, '&nbsp;').replace(/\n/g, '<br/>');
  }

  return text
    .replace(/ /g, '&nbsp;')
    .replace(/\n/g, '<br/>')
    .replace(
      regex,
      match =>
        `<mark style="background: yellow; color: black; border-radius: 3px; padding: 0 2px;">${match.trim()}</mark>`
    );
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
  const draftRef = useRef(value);
  const idleTimer = useRef<NodeJS.Timeout | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const [highlightHtml, setHighlightHtml] = useState(() =>
    getHighlightedHtml(value, searchTerm)
  );
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    draftRef.current = value;
    if (textareaRef.current && textareaRef.current.value !== value) {
      textareaRef.current.value = value;
    }

    setHighlightHtml(getHighlightedHtml(value, searchTerm));
  }, [value, searchTerm]);

  useEffect(() => {
    if (!highlightRef.current || !textareaRef.current) return;
    highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
  }, [highlightHtml]);

  const commit = useCallback(() => {
    onChange(draftRef.current);
  }, [onChange]);

  const refreshHighlight = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      setHighlightHtml(getHighlightedHtml(draftRef.current, searchTerm));
    });
  }, [searchTerm, setHighlightHtml]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (readOnly) return;
      draftRef.current = e.target.value;
      setIsTyping(true);

      refreshHighlight();

      // If the user cleared the field completely (e.g., Cmd/Ctrl+X or Delete),
      // commit immediately so the UI reflects the empty value without waiting
      // for the debounce timer.
      if (draftRef.current.length === 0) {
        if (idleTimer.current) {
          clearTimeout(idleTimer.current);
          idleTimer.current = null as any;
        }
        // Update highlight immediately for a crisp UI
        setHighlightHtml(getHighlightedHtml('', searchTerm));
        commit();
        return;
      }

      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
      }
      idleTimer.current = setTimeout(() => {
        setIsTyping(false);
        refreshHighlight();
        commit();
      }, 200);
    },
    [commit, refreshHighlight]
  );

  const handleBlur = useCallback(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
    }
    setIsTyping(false);
    refreshHighlight();
    commit();
  }, [commit, refreshHighlight]);

  const handleScroll = useCallback(() => {
    if (!highlightRef?.current || !textareaRef?.current) return;
    highlightRef.current.scrollTop = textareaRef?.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef?.current.scrollLeft;
  }, []);

  const handleFocus = useCallback(() => {
    if (readOnly) return;
    setIsTyping(true);
  }, [readOnly]);

  const handleKeyUp = useCallback(() => {
    if (readOnly) return;
    // After any key press, if the field is empty commit immediately so
    // the overlay/highlight clears without waiting for debounce.
    const cur = textareaRef.current?.value ?? '';
    if (cur.length === 0) {
      draftRef.current = '';
      setHighlightHtml(getHighlightedHtml('', searchTerm));
      commit();
    }
  }, [commit, searchTerm, readOnly]);

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

  const commonStyles = css`
    padding: 8px;
    font-size: 14px;
    line-height: 1.4;
    font-family: monospace;
    box-sizing: border-box;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow: auto;
    width: 100%;
    min-height: calc(${rows} * 1.4em + 16px);
  `;

  const highlightStyles = css`
    ${commonStyles}
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    pointer-events: none;
    color: #fff;
    border: 1px solid transparent;
    z-index: 1;
  `;

  const textareaStyles = (typing: boolean, ro: boolean) => css`
    ${commonStyles}
    position: relative;
    background: transparent;
    resize: none;
    border: ${ro ? '1px solid transparent' : '1px solid #555'};
    color: ${typing ? '#fff' : 'transparent'};
    caret-color: ${ro ? 'transparent' : '#fff'};
    z-index: 2;
    cursor: ${ro ? 'not-allowed' : 'text'};
  `;

  return (
    <div
      className={css`
        position: relative;
        width: 100%;
        min-height: calc(${rows} * 1.4em + 16px);
        ${readOnly
          ? `
          border: 1px dashed ${colors.border};
          border-radius: 6px;
          background: rgba(255,255,255,0.03);
        `
          : ''}
      `}
    >
      {readOnly && (
        <div
          className={css`
            position: absolute;
            top: 6px;
            right: 6px;
            z-index: 3;
            background: rgba(0, 0, 0, 0.5);
            color: #fff;
            border-radius: 10px;
            padding: 2px 6px;
            font-size: 11px;
            display: inline-flex;
            gap: 4px;
            align-items: center;
            pointer-events: none;
          `}
          aria-hidden
        >
        <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={css`
              stroke: currentColor;
              stroke-width: 2;
              stroke-linecap: round;
              stroke-linejoin: round;
            `}
          >
            <rect x="5" y="11" width="14" height="8" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span>{t('common.locked', 'Locked')}</span>
        </div>
      )}
      <div
        ref={highlightRef}
        className={highlightStyles}
        dangerouslySetInnerHTML={{ __html: highlightHtml }}
      />
      <textarea
        ref={textareaRef}
        className={textareaStyles(!readOnly && isTyping, readOnly)}
        placeholder={placeholder}
        rows={rows}
        defaultValue={value}
        onChange={handleInput}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onKeyUp={handleKeyUp}
        onScroll={handleScroll}
        readOnly={readOnly}
        aria-readonly={readOnly}
        title={readOnly ? t('common.lockedWhileProcessing', 'Locked while processing') : undefined}
      />
    </div>
  );
}

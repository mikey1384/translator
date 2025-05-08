import React, { useRef, useState, useCallback, useEffect } from 'react';
import { css } from '@emotion/css';

interface SubtitleEditTextareaProps {
  value: string;
  searchTerm: string;
  onChange: (newValue: string) => void;
  rows?: number;
  placeholder?: string;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\\]]/g, '\\$&');
}

function getHighlightedHtml(text: string, searchTerm: string): string {
  if (!searchTerm) {
    return text.replace(/ /g, '&nbsp;').replace(/\n/g, '<br/>');
  }

  const safeTerm = escapeRegExp(searchTerm);
  const regex = new RegExp(safeTerm, 'gi');

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
}: SubtitleEditTextareaProps) {
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
  }, [value]);

  useEffect(() => {
    setHighlightHtml(getHighlightedHtml(draftRef.current, searchTerm));
  }, [searchTerm]);

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
  }, [searchTerm]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      draftRef.current = e.target.value;
      setIsTyping(true);

      refreshHighlight();

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

  const textareaStyles = (typing: boolean) => css`
    ${commonStyles}
    position: relative;
    background: transparent;
    resize: none;
    border: 1px solid #555;
    color: ${typing ? '#fff' : 'transparent'};
    caret-color: #fff;
    z-index: 2;
  `;

  return (
    <div
      className={css`
        position: relative;
        width: 100%;
        min-height: calc(${rows} * 1.4em + 16px);
      `}
    >
      <div
        ref={highlightRef}
        className={highlightStyles}
        dangerouslySetInnerHTML={{ __html: highlightHtml }}
      />
      <textarea
        ref={textareaRef}
        className={textareaStyles(isTyping)}
        placeholder={placeholder}
        rows={rows}
        defaultValue={value}
        onChange={handleInput}
        onBlur={handleBlur}
        onScroll={handleScroll}
      />
    </div>
  );
}

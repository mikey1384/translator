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
  return text.replace(/[.*+?^${}()|[\\\]]/g, '\\$&');
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
  const [draft, setDraft] = useState(value);
  const highlightRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const highlightedHtml = getHighlightedHtml(draft, searchTerm);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setDraft(next);
    onChange(next); // write-through
  };

  const handleScroll = useCallback(() => {
    if (!highlightRef?.current || !textareaRef?.current) return;
    highlightRef.current.scrollTop = textareaRef?.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef?.current.scrollLeft;
  }, []);

  const commonStyles = css`
    padding: 8px;
    font-size: 14px;
    line-height: 1.4;
    font-family: monospace; // Use monospace for better alignment
    box-sizing: border-box;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow: auto;
    width: 100%;
    /* Approx height formula for "rows" */
    min-height: calc(
      ${rows} * 1.4em + 16px
    ); // 1.4em line height + 2 * 8px padding
  `;

  const highlightStyles = css`
    ${commonStyles}
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    pointer-events: none;
    /* Show text in the desired color (e.g., white for dark theme) */
    color: #fff; // Changed from #BBB to the primary text color
    border: 1px solid transparent; // Overlay shouldn't have its own border
    z-index: 1;
  `;

  const textareaStyles = css`
    ${commonStyles}
    position: relative;
    background: transparent;
    resize: none;
    border: 1px solid #555; // Keep the border for the interactive element
    color: transparent; // Make the actual textarea text invisible
    caret-color: #fff; // Ensure the caret is visible on dark background
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
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      />
      <textarea
        ref={textareaRef}
        className={textareaStyles}
        placeholder={placeholder}
        rows={rows}
        value={draft}
        onChange={handleInput}
        onScroll={handleScroll}
      />
    </div>
  );
}

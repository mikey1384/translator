import React, { useRef, useState, useCallback, useEffect } from 'react';
import { css } from '@emotion/css';

interface HighlightedTextareaProps {
  value: string;
  searchTerm: string;
  onChange: (newValue: string) => void;
  rows?: number;
  placeholder?: string;
}

// 1) Escape regex special chars
function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\\\]]/g, '\\$&');
}

function getHighlightedHtml(text: string, searchTerm: string): string {
  // If no searchTerm, just show text with <br/> + &nbsp; replacements
  if (!searchTerm) {
    return text.replace(/ /g, '&nbsp;').replace(/\n/g, '<br/>');
  }

  const safeTerm = escapeRegExp(searchTerm);
  const regex = new RegExp(safeTerm, 'gi');

  // Replace text + highlight all matches in <mark>
  return text
    .replace(/ /g, '&nbsp;')
    .replace(/\n/g, '<br/>')
    .replace(
      regex,
      // Keep the mark tag generation on a single line to avoid extra whitespace
      match =>
        `<mark style="background: yellow; color: black; border-radius: 3px; padding: 0 2px;">${match.trim()}</mark>`
    );
}

export function HighlightedTextarea({
  value,
  searchTerm,
  onChange,
  rows = 5,
  placeholder = '',
}: HighlightedTextareaProps) {
  const [inputValue, setInputValue] = useState(value);
  const highlightRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep local state in sync with external prop
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Generate the highlighting markup each render
  const highlightedHtml = getHighlightedHtml(inputValue, searchTerm);

  // Handle user input
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    onChange(e.target.value);
  };

  // Keep highlight layer scrolled to match the textarea
  const handleScroll = useCallback(() => {
    if (!highlightRef?.current || !textareaRef?.current) return;
    highlightRef.current.scrollTop = textareaRef?.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef?.current.scrollLeft;
  }, []);

  // Removed useEffect for manual event listener - relying on onScroll prop

  // Common styles for both overlay and textarea
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
      {/* Highlight layer */}
      <div
        ref={highlightRef}
        className={highlightStyles}
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      />

      {/* Actual editable textarea */}
      <textarea
        ref={textareaRef}
        className={textareaStyles}
        placeholder={placeholder}
        rows={rows}
        value={inputValue}
        onChange={handleInput}
        onScroll={handleScroll} // Rely on this for scroll sync
      />
    </div>
  );
}

export default HighlightedTextarea;

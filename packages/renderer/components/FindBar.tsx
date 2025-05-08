import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { colors } from '../styles.js';

const findBarStyles = css`
  position: fixed;
  top: 10px;
  right: 10px;
  background-color: ${colors.light};
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid ${colors.border};
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 1200;
  font-size: 0.9rem;
  color: ${colors.dark};
`;

const inputStyles = css`
  padding: 5px 9px;
  border: 1px solid ${colors.border};
  border-radius: 4px;
  background-color: ${colors.grayLight};
  color: ${colors.dark};
  min-width: 160px;
  font-size: 0.95rem;
  &:focus {
    outline: none;
    border-color: ${colors.primary};
    background-color: ${colors.grayLight};
    color: ${colors.dark};
  }
  &::-webkit-search-decoration,
  &::-webkit-search-cancel-button,
  &::-webkit-search-results-button,
  &::-webkit-search-results-decoration {
    -webkit-appearance: none;
  }
`;

const matchCountStyles = css`
  color: ${colors.gray};
  min-width: 50px; // Prevent layout shift
  text-align: center;
`;

const buttonStyles = css`
  background: none;
  border: 1px solid transparent; // Keep layout consistent
  color: ${colors.dark};
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition: background-color 0.1s ease;

  &:hover {
    background-color: ${colors.grayLight};
  }
  &:disabled {
    color: ${colors.gray};
    cursor: not-allowed;
    opacity: 0.6;
  }
`;

const closeButtonStyles = css`
  ${buttonStyles}
  margin-left: 5px;
`;

interface FindBarProps {
  isVisible: boolean;
  searchText: string;
  onSearchTextChange: (val: string) => void;
  matchCount: number;
  activeMatchIndex: number;
  onFindNext: () => void;
  onFindPrev: () => void;
  onClose: () => void;
  onReplaceAll?: (searchText: string, replaceText: string) => void;
}

export default function FindBar({
  isVisible,
  searchText,
  onSearchTextChange,
  matchCount,
  activeMatchIndex,
  onFindNext,
  onFindPrev,
  onClose,
  onReplaceAll,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [replaceText, setReplaceText] = useState('');

  useEffect(() => {
    if (isVisible) {
      inputRef?.current?.focus();
    }
  }, [isVisible]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchTextChange(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        onFindPrev();
      } else {
        onFindNext();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isVisible) {
    return null;
  }

  const hasMatches = matchCount > 0;
  const showMatchInfo =
    searchText.length > 0
      ? `${hasMatches ? activeMatchIndex + 1 : 0} of ${matchCount}`
      : '0 of 0';
  const matchInfoColor =
    matchCount === 0 && searchText.length > 0
      ? colors.danger || '#d9534f'
      : colors.gray;

  return (
    <div className={findBarStyles}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Find in subtitles..."
        value={searchText}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        className={inputStyles}
      />
      <input
        type="text"
        placeholder="Replace with..."
        value={replaceText}
        onChange={e => setReplaceText(e.target.value)}
        className={`${inputStyles} ${css`
          min-width: 120px;
        `}`}
      />
      <span className={matchCountStyles} style={{ color: matchInfoColor }}>
        {showMatchInfo}
      </span>
      <button
        className={buttonStyles}
        onClick={onFindNext}
        disabled={!hasMatches}
        title="Next Match (Enter)"
        aria-label="Next match"
      >
        <span style={{ verticalAlign: 'middle' }}>↓</span>
      </button>
      <button
        className={buttonStyles}
        onClick={onFindPrev}
        disabled={!hasMatches}
        title="Previous Match (Shift+Enter)"
        aria-label="Previous match"
      >
        <span style={{ verticalAlign: 'middle' }}>↑</span>
      </button>
      <button
        className={buttonStyles}
        onClick={() => onReplaceAll?.(searchText, replaceText)}
        disabled={!searchText || !replaceText || !onReplaceAll}
        title="Replace All Occurrences"
        aria-label="Replace all"
      >
        Replace All
      </button>
      <button
        className={closeButtonStyles}
        onClick={onClose}
        title="Close (Esc)"
        aria-label="Close find bar"
      >
        <span style={{ verticalAlign: 'middle' }}>✕</span>
      </button>
    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { css } from '@emotion/css';
import { colors } from '../styles';

// Simple icon components (replace with actual icons if you have an icon library)
const UpArrow = () => <span style={{ verticalAlign: 'middle' }}>↑</span>;
const DownArrow = () => <span style={{ verticalAlign: 'middle' }}>↓</span>;
const CloseIcon = () => <span style={{ verticalAlign: 'middle' }}>✕</span>;

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
  z-index: 1000;
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
  results: {
    matches: number;
    activeMatchOrdinal: number;
  };
  onClose: () => void;
}

const FindBar: React.FC<FindBarProps> = ({ isVisible, results, onClose }) => {
  const [searchText, setSearchText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref to store debounce timeout

  useEffect(() => {
    if (isVisible) {
      inputRef.current?.focus();
    } else {
      // Clear timeout if component becomes hidden
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    }
  }, [isVisible]);

  useEffect(() => {
    // Debounce the find request
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set a new timeout only if the bar is visible
    if (isVisible && window.electron) {
      debounceTimeoutRef.current = setTimeout(() => {
        console.log(`[FindBar] Debounced search for: "${searchText}"`);
        window.electron.sendFindInPage({ text: searchText });
      }, 300); // 300ms debounce delay
    }

    // Cleanup function to clear timeout if component unmounts or searchText changes again
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [searchText, isVisible]); // Effect runs when searchText or visibility changes

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value);
  };

  const handleFindNext = useCallback(() => {
    if (window.electron && searchText) {
      window.electron.sendFindInPage({
        text: searchText,
        findNext: true,
        forward: true,
      });
    }
  }, [searchText]);

  const handleFindPrev = useCallback(() => {
    if (window.electron && searchText) {
      window.electron.sendFindInPage({
        text: searchText,
        findNext: true,
        forward: false,
      });
    }
  }, [searchText]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handleFindPrev();
      } else {
        handleFindNext();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    }
  };

  const handleClose = () => {
    if (window.electron) {
      window.electron.sendStopFind();
    }
    onClose();
  };

  if (!isVisible) {
    return null;
  }

  const hasMatches = results.matches > 0;

  return (
    <div className={findBarStyles}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Find in page..."
        value={searchText}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        className={inputStyles}
      />
      <span className={matchCountStyles}>
        {searchText.length === 0
          ? ''
          : hasMatches
            ? `${results.activeMatchOrdinal} of ${results.matches}`
            : '0 of 0'}
      </span>
      <button
        className={buttonStyles}
        onClick={handleFindNext}
        disabled={!hasMatches}
        title="Next Match (Enter)"
      >
        <DownArrow />
      </button>
      <button
        className={buttonStyles}
        onClick={handleFindPrev}
        disabled={!hasMatches}
        title="Previous Match (Shift+Enter)"
      >
        <UpArrow />
      </button>
      <button
        className={closeButtonStyles}
        onClick={handleClose}
        title="Close (Esc)"
      >
        <CloseIcon />
      </button>
    </div>
  );
};

export default FindBar;

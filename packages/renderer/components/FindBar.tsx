import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { colors } from '../styles.js';
import { useUIStore } from '../state/ui-store.js';
import { useSubStore } from '../state/subtitle-store.js';
import { logButton } from '../utils/logger.js';

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

const inputReplaceStyles = css`
  ${inputStyles}
  min-width: 120px;
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

export default function FindBar() {
  const { t } = useTranslation();
  const {
    isVisible,
    searchText,
    setSearchText,
    matchCount,
    activeMatchIndex,
    findNext,
    findPrev,
    hideFindBar,
  } = useUIStore(state => ({
    isVisible: state.isFindBarVisible,
    searchText: state.searchText,
    setSearchText: state.setSearchText,
    matchCount: state.matchedIndices.length,
    activeMatchIndex: state.activeMatchIndex,
    findNext: state.handleFindNext,
    findPrev: state.handleFindPrev,
    hideFindBar: state.handleCloseFindBar,
  }));

  const inputRef = useRef<HTMLInputElement>(null);
  const [replaceText, setReplaceText] = useState('');
  const [draft, setDraft] = useState(searchText);
  const debounceId = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isVisible) {
      inputRef?.current?.focus();
    }
  }, [isVisible]);

  useEffect(() => {
    setDraft(searchText);
  }, [searchText]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDraft(value);
    if (debounceId.current) {
      clearTimeout(debounceId.current);
    }
    debounceId.current = setTimeout(() => {
      setSearchText(value);
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (debounceId.current) {
        clearTimeout(debounceId.current);
      }
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        findPrev();
      } else {
        findNext();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideFindBar();
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
        placeholder={t('findBar.findPlaceholder')}
        value={draft}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        className={inputStyles}
      />
      <input
        type="text"
        placeholder={t('findBar.replacePlaceholder')}
        value={replaceText}
        onChange={e => setReplaceText(e.target.value)}
        className={inputReplaceStyles}
      />
      <span className={matchCountStyles} style={{ color: matchInfoColor }}>
        {showMatchInfo}
      </span>
      <button
        className={buttonStyles}
        onClick={() => {
          try { logButton('findbar_next'); } catch {}
          findNext();
        }}
        disabled={!hasMatches}
        title={t('findBar.nextMatch')}
        aria-label={t('findBar.nextMatchAria')}
      >
        <span style={{ verticalAlign: 'middle' }}>↓</span>
      </button>
      <button
        className={buttonStyles}
        onClick={() => {
          try { logButton('findbar_prev'); } catch {}
          findPrev();
        }}
        disabled={!hasMatches}
        title={t('findBar.previousMatch')}
        aria-label={t('findBar.previousMatchAria')}
      >
        <span style={{ verticalAlign: 'middle' }}>↑</span>
      </button>
      <button
        className={buttonStyles}
        onClick={() => {
          try { logButton('findbar_replace_all'); } catch {}
          useSubStore.getState().replaceAll(searchText, replaceText);
        }}
        disabled={!searchText || !replaceText}
        title={t('findBar.replaceAllTitle')}
        aria-label={t('findBar.replaceAllAria')}
      >
        {t('findBar.replaceAll')}
      </button>
      <button
        className={closeButtonStyles}
        onClick={() => {
          try { logButton('findbar_close'); } catch {}
          hideFindBar();
        }}
        title={t('findBar.closeTitle')}
        aria-label={t('findBar.closeAria')}
      >
        <span style={{ verticalAlign: 'middle' }}>✕</span>
      </button>
    </div>
  );
}

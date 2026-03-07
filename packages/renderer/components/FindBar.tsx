import React, { useEffect, useRef, useState } from 'react';
import { cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../state/ui-store.js';
import { useSubStore } from '../state/subtitle-store.js';
import { logButton } from '../utils/logger.js';
import Button from './Button.js';
import {
  editorButtonContentStyles,
  editorFindBarStyles,
  editorFindIconButtonStyles,
  editorFindInputStyles,
  editorFindMatchCountErrorStyles,
  editorFindMatchCountStyles,
  editorFindReplaceInputStyles,
} from '../containers/EditSubtitles/edit-workspace-styles';

export default function FindBar() {
  const { t } = useTranslation();
  const isVisible = useUIStore(state => state.isFindBarVisible);
  const searchText = useUIStore(state => state.searchText);
  const setSearchText = useUIStore(state => state.setSearchText);
  const matchCount = useUIStore(state => state.matchedIndices.length);
  const activeMatchIndex = useUIStore(state => state.activeMatchIndex);
  const findNext = useUIStore(state => state.handleFindNext);
  const findPrev = useUIStore(state => state.handleFindPrev);
  const hideFindBar = useUIStore(state => state.handleCloseFindBar);

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

  return (
    <div className={editorFindBarStyles}>
      <input
        ref={inputRef}
        type="text"
        placeholder={t('findBar.findPlaceholder')}
        value={draft}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        className={editorFindInputStyles}
      />
      <input
        type="text"
        placeholder={t('findBar.replacePlaceholder')}
        value={replaceText}
        onChange={e => setReplaceText(e.target.value)}
        className={editorFindReplaceInputStyles}
      />
      <span
        className={cx(
          editorFindMatchCountStyles,
          matchCount === 0 && searchText.length > 0
            ? editorFindMatchCountErrorStyles
            : ''
        )}
      >
        {showMatchInfo}
      </span>
      <button
        className={editorFindIconButtonStyles}
        onClick={() => {
          try {
            logButton('findbar_next');
          } catch {
            // Do nothing
          }
          findNext();
        }}
        disabled={!hasMatches}
        title={t('findBar.nextMatch')}
        aria-label={t('findBar.nextMatchAria')}
      >
        <span>↓</span>
      </button>
      <button
        className={editorFindIconButtonStyles}
        onClick={() => {
          try {
            logButton('findbar_prev');
          } catch {
            // Do nothing
          }
          findPrev();
        }}
        disabled={!hasMatches}
        title={t('findBar.previousMatch')}
        aria-label={t('findBar.previousMatchAria')}
      >
        <span>↑</span>
      </button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          try {
            logButton('findbar_replace_all');
          } catch {
            // Do nothing
          }
          useSubStore.getState().replaceAll(searchText, replaceText);
        }}
        disabled={!searchText || !replaceText}
        title={t('findBar.replaceAllTitle')}
      >
        <span className={editorButtonContentStyles}>
          {t('findBar.replaceAll')}
        </span>
      </Button>
      <button
        className={editorFindIconButtonStyles}
        onClick={() => {
          try {
            logButton('findbar_close');
          } catch {
            // Do nothing
          }
          hideFindBar();
        }}
        title={t('findBar.closeTitle')}
        aria-label={t('findBar.closeAria')}
      >
        <span>✕</span>
      </button>
    </div>
  );
}

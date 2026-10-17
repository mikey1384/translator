import React, { useEffect, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { CaseSensitive, Replace, WholeWord } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../state/ui-store.js';
import { useSubStore } from '../state/subtitle-store.js';
import { logButton } from '../utils/logger.js';
import { useFindOptions } from '../utils/subtitleFind.js';
import { colors } from '../styles.js';
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

// The count never wraps or clips ("12 of 1960" stays whole in narrow RTL).
const matchCountNoClipStyles = css`
  white-space: nowrap;
  flex-shrink: 0;
  min-width: max-content;
`;

const toggleOnStyles = css`
  &[aria-pressed='true'] {
    border-color: ${colors.primary};
    color: ${colors.primary};
    background: rgba(255, 216, 77, 0.12);
  }
`;

const replaceRowStyles = css`
  display: flex;
  flex: 1 0 100%;
  align-items: center;
  gap: inherit;
  flex-wrap: wrap;
`;

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

  const matchCase = useFindOptions(state => state.matchCase);
  const wholeWord = useFindOptions(state => state.wholeWord);
  const setMatchCase = useFindOptions(state => state.setMatchCase);
  const setWholeWord = useFindOptions(state => state.setWholeWord);

  const inputRef = useRef<HTMLInputElement>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
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
  const showMatchInfo = t('findBar.matchCount', '{{current}} of {{total}}', {
    current: searchText.length > 0 && hasMatches ? activeMatchIndex + 1 : 0,
    total: searchText.length > 0 ? matchCount : 0,
  });
  const matchCaseLabel = t('findBar.matchCase', 'Match case');
  const wholeWordLabel = t('findBar.wholeWord', 'Whole word');
  const replaceToggleLabel = t('findBar.showReplace', 'Replace');

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
      <button
        type="button"
        className={cx(editorFindIconButtonStyles, toggleOnStyles)}
        aria-pressed={matchCase}
        onClick={() => setMatchCase(!matchCase)}
        title={matchCaseLabel}
        aria-label={matchCaseLabel}
      >
        <CaseSensitive size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={cx(editorFindIconButtonStyles, toggleOnStyles)}
        aria-pressed={wholeWord}
        onClick={() => setWholeWord(!wholeWord)}
        title={wholeWordLabel}
        aria-label={wholeWordLabel}
      >
        <WholeWord size={18} aria-hidden="true" />
      </button>
      <span
        aria-live="polite"
        className={cx(
          editorFindMatchCountStyles,
          matchCountNoClipStyles,
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
      <button
        type="button"
        className={cx(editorFindIconButtonStyles, toggleOnStyles)}
        aria-pressed={replaceOpen}
        aria-expanded={replaceOpen}
        onClick={() => setReplaceOpen(open => !open)}
        title={replaceToggleLabel}
        aria-label={replaceToggleLabel}
      >
        <Replace size={18} aria-hidden="true" />
      </button>
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
      {replaceOpen ? (
        <div className={replaceRowStyles}>
          <input
            type="text"
            placeholder={t('findBar.replacePlaceholder')}
            value={replaceText}
            onChange={e => setReplaceText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                hideFindBar();
              }
            }}
            className={editorFindReplaceInputStyles}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              try {
                logButton('findbar_replace_all');
              } catch {
                // Do nothing
              }
              // An empty replacement deletes the matches.
              useSubStore.getState().replaceAll(searchText, replaceText, {
                matchCase,
                wholeWord,
              });
            }}
            disabled={!searchText.trim() || !hasMatches}
            title={t('findBar.replaceAllTitle')}
          >
            <span className={editorButtonContentStyles}>
              {t('findBar.replaceAll')}
            </span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '../i18n.js';
import { colors } from '../styles.js';

import {
  allUiLanguageOptions,
  baseLanguageOptions,
  languageGroups,
  uiLanguageEndonym,
  type LanguageOption,
} from '../constants/ui-languages.js';
import {
  createTypeaheadBuffer,
  findTypeaheadMatch,
} from '../utils/typeahead.js';

const languageSwitcherContainer = css`
  position: relative;
`;

const triggerStyles = css`
  height: 40px;
  max-width: 180px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: 20px;
  border: 1px solid ${colors.border};
  background: transparent;
  color: ${colors.text};
  font: inherit;
  font-size: 0.88rem;
  cursor: pointer;

  &:hover {
    border-color: ${colors.borderStrong};
  }

  &:focus-visible {
    outline: 2px solid ${colors.primaryLight};
    outline-offset: 2px;
  }

  @media (max-width: 720px) {
    padding: 0 10px;
  }
`;

const triggerNameStyles = css`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  @media (max-width: 720px) {
    display: none;
  }
`;

const dropdownListStyles = css`
  position: absolute;
  top: calc(100% + 6px);
  inset-inline-end: 0;
  background-color: ${colors.surfaceRaised};
  border: 1px solid ${colors.borderStrong};
  border-radius: 12px;
  max-height: min(420px, 70vh);
  overflow-y: auto;
  z-index: 1100;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.4);
  color: ${colors.text};
  width: 220px;
  padding: 4px;
  box-sizing: border-box;

  &:focus {
    outline: none;
  }
`;

const dropdownOptionStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.9rem;

  &:hover,
  &[data-active='true'] {
    background-color: ${colors.grayLight};
  }
`;

const selectedOptionStyle = css`
  color: ${colors.primary};
  font-weight: 600;
`;

const optionSecondaryStyles = css`
  color: ${colors.textDim};
  font-size: 0.78rem;
  font-weight: 400;
  white-space: nowrap;
`;

const dropdownGroupLabelStyles = css`
  padding: 10px 10px 4px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: ${colors.textDim};
  cursor: default;
`;

function GlobeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </svg>
  );
}

/**
 * UI-language picker. Each language is shown by its own name (flags can't
 * tell Hindi, Marathi and Telugu apart, and needed the network), and it is a
 * real button + listbox so keyboard and screen-reader users can switch.
 */
export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [currentLanguage, setCurrentLanguage] = useState(i18n.language || 'en');
  const [isOpen, setIsOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef(createTypeaheadBuffer());
  const options = allUiLanguageOptions();
  const currentOption =
    options.find(opt => opt.value === currentLanguage) ?? options[0];
  const listId = 'ui-language-listbox';
  const label = t('common.uiLanguage', 'Interface language');

  useEffect(() => {
    setCurrentLanguage(i18n.language);
  }, [i18n.language]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    listRef.current?.focus();
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !activeValue) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-value="${activeValue}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeValue]);

  const openList = () => {
    typeahead.current.reset();
    setActiveValue(currentOption.value);
    setIsOpen(true);
  };

  const closeList = (restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const moveActive = (delta: number | 'first' | 'last') => {
    const index = options.findIndex(opt => opt.value === activeValue);
    let next: number;
    if (delta === 'first') next = 0;
    else if (delta === 'last') next = options.length - 1;
    else next = Math.min(options.length - 1, Math.max(0, index + delta));
    setActiveValue(options[next].value);
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        moveActive('first');
        break;
      case 'End':
        event.preventDefault();
        moveActive('last');
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (activeValue) void handleLanguageChange(activeValue);
        break;
      case 'Escape':
        event.preventDefault();
        closeList(true);
        break;
      case 'Tab':
        closeList(false);
        break;
      default:
        // Type-ahead on the language's own name, its name in the UI
        // language, or its English name; keystrokes accumulate ("deu").
        // IME keystrokes ("Process") arrive later as a composition.
        if (
          event.key.length === 1 &&
          !event.nativeEvent.isComposing &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          typeToFind(event.key);
        }
    }
  };

  const typeToFind = (text: string) => {
    if (!text) return;
    const query = typeahead.current.push(text);
    const match = findTypeaheadMatch(
      options.map(opt => ({
        value: opt.value,
        names: [
          uiLanguageEndonym(opt),
          t(opt.label, uiLanguageEndonym(opt)),
          t(opt.label, { lng: 'en', defaultValue: opt.value }),
        ],
      })),
      query,
      activeValue
    );
    if (match) setActiveValue(match);
  };

  const renderOption = (lang: LanguageOption) => {
    const selected = currentLanguage === lang.value;
    const endonym = uiLanguageEndonym(lang);
    const localized = t(lang.label, endonym);
    return (
      <div
        key={lang.value}
        id={`ui-language-option-${lang.value}`}
        data-value={lang.value}
        role="option"
        aria-selected={selected}
        data-active={activeValue === lang.value}
        lang={lang.value}
        className={cx(dropdownOptionStyles, selected && selectedOptionStyle)}
        onMouseEnter={() => setActiveValue(lang.value)}
        onClick={() => void handleLanguageChange(lang.value)}
      >
        <span>{endonym}</span>
        {localized !== endonym ? (
          <span
            className={optionSecondaryStyles}
            lang={i18n.language}
            aria-hidden="true"
          >
            {localized}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className={languageSwitcherContainer} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerStyles}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-label={`${label}: ${uiLanguageEndonym(currentOption)}`}
        title={label}
        onClick={() => (isOpen ? closeList(false) : openList())}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openList();
          }
        }}
      >
        <GlobeIcon />
        <span className={triggerNameStyles} lang={currentOption.value}>
          {uiLanguageEndonym(currentOption)}
        </span>
      </button>

      {isOpen && (
        <div
          ref={listRef}
          id={listId}
          className={dropdownListStyles}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={
            activeValue ? `ui-language-option-${activeValue}` : undefined
          }
          onKeyDown={handleListKeyDown}
          onCompositionEnd={event => typeToFind(event.data)}
        >
          {baseLanguageOptions.map(renderOption)}
          {languageGroups.map(group => (
            <div
              key={group.label}
              role="group"
              aria-labelledby={`ui-language-group-${group.label}`}
            >
              <div
                id={`ui-language-group-${group.label}`}
                className={dropdownGroupLabelStyles}
                role="presentation"
              >
                {t(group.label)}
              </div>
              {group.options.map(renderOption)}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  async function handleLanguageChange(languageValue: string) {
    try {
      setCurrentLanguage(languageValue);
      closeList(true);
      await changeLanguage(languageValue);
    } catch (error) {
      console.error(`[LanguageSwitcher] Error changing language:`, error);
      setCurrentLanguage(i18n.language);
    }
  }
}

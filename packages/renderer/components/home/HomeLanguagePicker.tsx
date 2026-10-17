import { css, cx } from '@emotion/css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { colors, fonts } from '../../styles';
import { TRANSLATION_LANGUAGE_GROUPS } from '../../constants/translation-languages';
import {
  allTranslationLanguageValues,
  nativeLanguageName,
} from '../../constants/translation-language-native-names';
import {
  captureFocusReturnTarget,
  restoreFocus,
} from '../../utils/focusReturn';

const chipRow = css`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
`;

const chip = (active: boolean) => css`
  min-height: 32px;
  padding: 0 13px;
  border-radius: 16px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  /* The chosen language is outlined, not filled: the one filled yellow
     button on Home is the main action. */
  border: 1px solid ${active ? colors.primary : colors.borderStrong};
  background: ${active ? 'rgba(255, 216, 77, 0.12)' : 'transparent'};
  color: ${active ? colors.primary : colors.muted};
  transition:
    background 0.12s ease,
    border-color 0.12s ease;

  &:hover {
    border-color: ${active ? colors.primary : colors.gray};
  }

  &:focus-visible {
    outline: 2px solid ${colors.primaryLight};
    outline-offset: 2px;
  }
`;

const moreChip = css`
  ${chip(false)}
  border-style: dashed;
`;

const overlay = css`
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: ${colors.overlay};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const dialog = css`
  width: min(880px, 100%);
  max-height: min(680px, calc(100vh - 48px));
  box-sizing: border-box;
  padding: 26px;
  border-radius: 24px;
  background: ${colors.surface};
  border: 1px solid ${colors.borderStrong};
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: ${colors.text};
`;

const dialogHeader = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const dialogTitle = css`
  margin: 0;
  font-family: ${fonts.display};
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
`;

const closeButton = css`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  border: 1px solid ${colors.borderStrong};
  background: transparent;
  color: ${colors.muted};
  font-size: 1.2rem;
  cursor: pointer;
`;

const searchInput = css`
  flex: none;
  height: 46px;
  box-sizing: border-box;
  padding: 0 16px;
  border-radius: 12px;
  border: 1px solid ${colors.borderStrong};
  background: ${colors.bg};
  color: ${colors.text};
  font: inherit;
  font-size: 0.95rem;
  outline: none;

  &:focus {
    border-color: ${colors.primary};
  }
`;

const groupList = css`
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-inline-end: 4px;
`;

const groupLabel = css`
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${colors.gray};
  margin-bottom: 8px;
`;

const grid = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
`;

const option = (active: boolean) => css`
  min-height: 52px;
  padding: 7px 12px;
  border-radius: 12px;
  text-align: start;
  font: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid ${active ? colors.primary : colors.border};
  background: ${active ? colors.primary : colors.surfaceSoft};
  color: ${active ? colors.onPrimary : colors.text};

  &:hover {
    border-color: ${active ? colors.primary : colors.borderStrong};
  }
`;

const optionNative = css`
  font-size: 0.95rem;
  font-weight: 600;
`;

const optionLocal = css`
  font-size: 0.75rem;
  opacity: 0.72;
`;

const emptyText = css`
  color: ${colors.textDim};
  font-size: 0.9rem;
`;

interface HomeLanguagePickerProps {
  value: string;
  quickPicks: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function HomeLanguagePicker({
  value,
  quickPicks,
  onChange,
  disabled = false,
}: HomeLanguagePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const totalLanguages = useMemo(
    () => allTranslationLanguageValues().length,
    []
  );

  useEffect(() => {
    if (!open) return;
    // Back to "All languages" (or wherever focus was) when it closes.
    const returnTo = captureFocusReturnTarget();
    searchRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.setTimeout(() => restoreFocus(returnTo), 0);
    };
  }, [open]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Word-prefix matching: "ara" finds Arabic, not Marathi.
    const startsAWord = (text: string) =>
      text
        .toLowerCase()
        .split(/[\s()/_-]+/)
        .some(word => word.startsWith(needle));
    const matches = (languageValue: string, labelKey: string) =>
      !needle ||
      startsAWord(nativeLanguageName(languageValue)) ||
      startsAWord(t(labelKey)) ||
      startsAWord(languageValue);
    const english = { value: 'english', labelKey: 'languages.english' };
    return [
      {
        labelKey: 'home.languagePickerCommon',
        options: [english].filter(o => matches(o.value, o.labelKey)),
      },
      ...TRANSLATION_LANGUAGE_GROUPS.map(group => ({
        labelKey: group.labelKey,
        options: group.options.filter(
          o => o.value !== 'english' && matches(o.value, o.labelKey)
        ),
      })),
    ].filter(group => group.options.length > 0);
  }, [query, t]);

  const choose = (languageValue: string) => {
    onChange(languageValue);
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <span className={chipRow}>
        {quickPicks.map(languageValue => (
          <button
            key={languageValue}
            type="button"
            className={chip(languageValue === value)}
            aria-pressed={languageValue === value}
            onClick={() => onChange(languageValue)}
            disabled={disabled}
          >
            {nativeLanguageName(languageValue)}
          </button>
        ))}
        <button
          type="button"
          className={moreChip}
          onClick={() => setOpen(true)}
          disabled={disabled}
        >
          {t('home.allLanguages', 'All {{count}} languages', {
            count: totalLanguages,
          })}
        </button>
      </span>

      {open ? (
        <div
          className={overlay}
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            className={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-language-picker-title"
          >
            <div className={dialogHeader}>
              <h2 id="home-language-picker-title" className={dialogTitle}>
                {t('home.languagePickerTitle', 'Make it speak…')}
              </h2>
              <button
                type="button"
                className={closeButton}
                aria-label={t('common.close', 'Close')}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <input
              ref={searchRef}
              className={searchInput}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t(
                'home.languageSearchPlaceholder',
                'Search languages — e.g. Arabic, 한국어, Deutsch'
              )}
              aria-label={t('home.languageSearchLabel', 'Search languages')}
            />
            <div className={groupList}>
              {groups.length === 0 ? (
                <span className={emptyText}>
                  {t('home.languageSearchEmpty', 'No language matches that.')}
                </span>
              ) : (
                groups.map(group => (
                  <div key={group.labelKey}>
                    <div className={groupLabel}>
                      {group.labelKey === 'home.languagePickerCommon'
                        ? t('home.languagePickerCommon', 'Common')
                        : t(group.labelKey)}
                    </div>
                    <div className={grid}>
                      {group.options.map(o => (
                        <button
                          key={o.value}
                          type="button"
                          className={cx(option(o.value === value))}
                          aria-pressed={o.value === value}
                          onClick={() => choose(o.value)}
                        >
                          <span className={optionNative}>
                            {nativeLanguageName(o.value)}
                          </span>
                          <span className={optionLocal}>{t(o.labelKey)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

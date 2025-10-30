import { cx } from '@emotion/css';
import type { TFunction } from 'i18next';
import type { LearningEntry } from '@shared-types/app';
import { friendlySource, formatTimestamp, normalizeDir } from './helpers';
import type { LanguageKey, SelectedEntryState } from './types';
import {
  entrySelectedStyles,
  entryStyles,
  entryTitleStyles,
  infoStyles,
  languageTagActiveStyles,
  languageTagStyles,
  languagesRowStyles,
  listStyles,
  metaItemStyles,
  metaRowStyles,
} from './styles';

interface LearningHubEntryListProps {
  entries: LearningEntry[];
  selected: SelectedEntryState | null;
  onSelectLanguage: (entry: LearningEntry, language: LanguageKey) => void;
  t: TFunction;
  locale: string;
}

const resolveLanguageOptions = (
  entry: LearningEntry,
  t: TFunction
): { key: LanguageKey; label: string }[] => {
  const options: { key: LanguageKey; label: string }[] = [];

  if (entry.transcriptPath) {
    options.push({
      key: 'transcript',
      label: t('learningHub.languages.original', 'Original transcript'),
    });
  }

  Object.keys(entry.translations || {})
    .sort()
    .forEach(code => {
      options.push({
        key: code,
        label: t('learningHub.languages.translation', '{{lang}} translation', {
          lang: code,
        }),
      });
    });

  return options;
};

export default function LearningHubEntryList({
  entries,
  selected,
  onSelectLanguage,
  t,
  locale,
}: LearningHubEntryListProps) {
  return (
    <ul className={listStyles}>
      {entries.map(entry => {
        const languageOptions = resolveLanguageOptions(entry, t);
        const defaultLanguage = languageOptions[0]?.key;

        return (
          <li
            key={entry.id}
            className={cx(
              entryStyles,
              selected?.id === entry.id && entrySelectedStyles
            )}
            onClick={() => {
              if (defaultLanguage) {
                void onSelectLanguage(entry, defaultLanguage);
              }
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (defaultLanguage) {
                  void onSelectLanguage(entry, defaultLanguage);
                }
              }
            }}
            role="listitem"
            tabIndex={0}
          >
            <div className={entryTitleStyles}>
              <span>{entry.title}</span>
              <span className={infoStyles}>
                {normalizeDir(entry.videoDir) ??
                  t('learningHub.noPath', 'Location unknown')}
              </span>
            </div>
            <div className={metaRowStyles}>
              <span className={metaItemStyles}>
                {friendlySource(entry.sourceType, t)}
              </span>
              <span className={metaItemStyles}>
                {t('learningHub.updatedAt', 'Updated {{date}}', {
                  date: formatTimestamp(entry.updatedAt, locale),
                })}
              </span>
            </div>
            {languageOptions.length > 0 && (
              <div className={languagesRowStyles}>
                {languageOptions.map(option => (
                  <span
                    key={option.key}
                    className={cx(
                      languageTagStyles,
                      selected?.id === entry.id &&
                        selected.language === option.key
                        ? languageTagActiveStyles
                        : null
                    )}
                    onClick={event => {
                      event.stopPropagation();
                      void onSelectLanguage(entry, option.key);
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        void onSelectLanguage(entry, option.key);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {option.label}
                  </span>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

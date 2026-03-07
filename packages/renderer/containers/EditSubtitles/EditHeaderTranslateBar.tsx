import React from 'react';
import { useTranslation } from 'react-i18next';

import Button from '../../components/Button';
import {
  TRANSLATION_LANGUAGE_GROUPS,
  TRANSLATION_LANGUAGES_BASE,
} from '../../constants/translation-languages';
import { useUIStore } from '../../state';
import {
  editorTranslateBarStyles,
  editorTranslateLabelStyles,
  editorTranslateSelectStyles,
} from './edit-workspace-styles';

type EditHeaderTranslateBarProps = {
  disabled?: boolean;
  onTranslate: () => void;
};

export default function EditHeaderTranslateBar({
  disabled,
  onTranslate,
}: EditHeaderTranslateBarProps) {
  const { t } = useTranslation();
  const targetLanguage = useUIStore(s => s.targetLanguage);
  const setTargetLanguage = useUIStore(s => s.setTargetLanguage);

  return (
    <div className={editorTranslateBarStyles}>
      <label className={editorTranslateLabelStyles}>
        {t('subtitles.outputLanguage')}:
      </label>
      <select
        className={editorTranslateSelectStyles}
        value={targetLanguage}
        onChange={e => setTargetLanguage(e.target.value)}
        disabled={disabled}
      >
        {TRANSLATION_LANGUAGES_BASE.map(opt => (
          <option key={opt.value} value={opt.value}>
            {t(opt.labelKey)}
          </option>
        ))}
        {TRANSLATION_LANGUAGE_GROUPS.map(group => (
          <optgroup key={group.labelKey} label={t(group.labelKey)}>
            {group.options.map(opt => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <Button
        variant="primary"
        size="sm"
        onClick={onTranslate}
        disabled={disabled}
      >
        {t('subtitles.translate', 'Translate')}
      </Button>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { css } from '@emotion/css';
import { colors, linkStyles as globalLinkStyles } from '../styles';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../state';

export default function SettingsPage() {
  const { t } = useTranslation();

  const { loading, keySet, saveKey, saveStatus, fetchStatus } =
    useSettingsStore();

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = loading || saving;

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const indicator = loading ? (
    t('common.loading')
  ) : keySet ? (
    <span
      className={css`
        display: inline-block;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 0.9em;
        margin-left: 15px;
        vertical-align: middle;
        background-color: rgba(76, 201, 176, 0.1);
        color: ${colors.success};
        border: 1px solid ${colors.success};
      `}
    >
      {t('settings.keySet')}
    </span>
  ) : (
    <span
      className={css`
        display: inline-block;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 0.9em;
        margin-left: 15px;
        vertical-align: middle;
        background-color: rgba(230, 94, 106, 0.1);
        color: ${colors.danger};
        border: 1px solid ${colors.danger};
      `}
    >
      {t('settings.keyNotSet')}
    </span>
  );

  const handleSave = async () => {
    setSaving(true);
    await saveKey(draft.trim());
    setSaving(false);
    setDraft('');
  };

  const handleRemove = async () => {
    if (!window.confirm(t('settings.openai.confirmRemovePrompt'))) return;
    setSaving(true);
    await saveKey('');
    setSaving(false);
  };

  return (
    <div
      className={css`
        padding: 30px;
        max-width: 700px;
        margin: 20px auto;
        background-color: ${colors.white};
        border-radius: 8px;
        border: 1px solid ${colors.border};
      `}
    >
      <h1
        className={css`
          font-size: 1.8em;
          color: ${colors.dark};
          margin-bottom: 25px;
          border-bottom: 1px solid ${colors.border};
          padding-bottom: 15px;
        `}
      >
        {t('settings.title')}
      </h1>

      <div
        className={css`
          font-size: 0.9em;
          color: ${colors.grayDark};
          line-height: 1.4;
          margin-top: 10px;
          margin-bottom: 15px;
        `}
      >
        {t('settings.description.para1')}
        <br />
        <br />
        {t('settings.description.para2.part1')}{' '}
        <a
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          className={css`
            ${globalLinkStyles}
          `}
        >
          {t('settings.description.para2.link')}
        </a>
        .<br />
        <br />
        {t('settings.description.para3')}
      </div>

      <div
        className={css`
          margin-bottom: 35px;
          padding: 20px;
          background-color: ${colors.light};
          border: 1px solid ${colors.border};
          border-radius: 6px;
        `}
      >
        <div
          className={css`
            font-size: 1.3em;
            color: ${colors.dark};
            margin-bottom: 20px;
          `}
        >
          {t('settings.openai.sectionTitle')}
          {indicator}
        </div>
        {keySet && (
          <div
            className={css`
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 10px 15px;
              background-color: ${colors.light};
              border: 1px solid ${colors.border};
              border-radius: 4px;
              margin-bottom: 15px;
            `}
          >
            <span
              className={css`
                font-weight: 500;
                color: ${colors.dark};
              `}
            >
              {t('settings.openai.isSet')}
            </span>
            <div
              className={css`
                display: flex;
                gap: 8px;
              `}
            >
              <button
                className={css`
                  padding: 5px 10px;
                  font-size: 0.85em;
                  background-color: ${colors.grayLight};
                  color: ${colors.dark};
                  border: 1px solid ${colors.border};
                  border-radius: 4px;
                  cursor: pointer;
                  transition:
                    background-color 0.2s ease,
                    border-color 0.2s ease;
                  box-shadow: none;

                  &:hover {
                    background-color: ${colors.light};
                    border-color: ${colors.primary};
                  }
                  &:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                  }
                  &[style*='color: #dc3545'] {
                    &:hover {
                      background: #f8d7da;
                    }
                  }
                `}
                onClick={handleRemove}
                disabled={busy}
                aria-disabled={busy}
                style={{ color: '#dc3545', borderColor: '#dc3545' }}
              >
                {t('settings.removeKey')}
              </button>
            </div>
          </div>
        )}
        {!keySet && (
          <>
            <label
              htmlFor="openai"
              className={css`
                display: block;
                margin-bottom: 8px;
                font-weight: 600;
                color: ${colors.grayDark};
              `}
            >
              {t('settings.openai.apiKeyLabel')}:
            </label>
            <input
              id="openai"
              type="password"
              className={css`
                width: 100%;
                padding: 10px 12px;
                border: 1px solid ${colors.border};
                border-radius: 4px;
                font-size: 1em;
                box-sizing: border-box;
                margin-bottom: 15px;
                background-color: ${colors.grayLight};
                color: ${colors.dark};
                transition: border-color 0.2s ease;

                &:focus {
                  outline: none;
                  border-color: ${colors.primary};
                  box-shadow: none;
                }

                &::placeholder {
                  color: ${colors.gray};
                }
              `}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={t('settings.openai.placeholder')}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                className={css`
                  padding: 10px 18px;
                  background-color: ${colors.primary};
                  color: white;
                  border: none;
                  border-radius: 4px;
                  cursor: pointer;
                  font-size: 1em;
                  transition: background-color 0.2s ease;
                  margin-right: 10px;
                  box-shadow: none;

                  &:hover {
                    background-color: ${colors.primaryLight};
                  }
                  &:disabled {
                    background-color: ${colors.gray};
                    color: ${colors.grayDark};
                    cursor: not-allowed;
                    opacity: 0.7;
                  }
                `}
                onClick={handleSave}
                disabled={busy || (!draft.trim() && keySet)}
                aria-disabled={busy || (!draft.trim() && keySet)}
              >
                {t('common.save')}
              </button>
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className={css`
                  ${globalLinkStyles}
                `}
                style={{ marginLeft: 'auto' }}
              >
                {t('settings.getKey', { name: 'OpenAI' })}
              </a>
            </div>
          </>
        )}
        {saveStatus && (
          <p
            className={
              saveStatus.ok
                ? css`
                    margin-top: 15px;
                    padding: 10px;
                    border: 1px solid ${colors.success};
                    background-color: rgba(76, 201, 176, 0.15);
                    color: ${colors.success};
                    border-radius: 4px;
                    font-size: 0.95em;
                  `
                : css`
                    margin-top: 15px;
                    padding: 10px;
                    border: 1px solid ${colors.danger};
                    background-color: rgba(230, 94, 106, 0.15);
                    color: ${colors.danger};
                    border-radius: 4px;
                    font-size: 0.95em;
                  `
            }
            role="status"
            aria-live="polite"
          >
            {saveStatus.msg}
          </p>
        )}
      </div>
    </div>
  );
}

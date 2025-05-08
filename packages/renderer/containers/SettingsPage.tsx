import { useState } from 'react';
import { css } from '@emotion/css';
import { colors, linkStyles as globalLink } from '../styles';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../state/settings-store';

const page = css`
  padding: 30px;
  max-width: 700px;
  margin: 20px auto;
  background: ${colors.white};
  border: 1px solid ${colors.border};
  border-radius: 8px;
`;
const h1 = css`
  font-size: 1.8em;
  color: ${colors.dark};
  margin-bottom: 25px;
  border-bottom: 1px solid ${colors.border};
  padding-bottom: 15px;
`;
const info = css`
  font-size: 0.9em;
  color: ${colors.grayDark};
  line-height: 1.4;
  margin: 10px 0 15px;
`;
const box = css`
  margin-bottom: 35px;
  padding: 20px;
  background: ${colors.light};
  border: 1px solid ${colors.border};
  border-radius: 6px;
`;
const h2 = css`
  font-size: 1.3em;
  color: ${colors.dark};
  margin-bottom: 20px;
  display: flex;
  gap: 12px;
  align-items: center;
`;
const label = css`
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: ${colors.grayDark};
`;
const input = css`
  width: 100%;
  padding: 10px 12px;
  margin-bottom: 15px;
  border: 1px solid ${colors.border};
  border-radius: 4px;
  font-size: 1em;
  background: ${colors.grayLight};
  color: ${colors.dark};
  &:focus {
    outline: none;
    border-color: ${colors.primary};
  }
`;
const btn = css`
  padding: 10px 18px;
  background: ${colors.primary};
  color: #fff;
  border: none;
  border-radius: 4px;
  margin-right: 10px;
  cursor: pointer;
  &:hover {
    background: ${colors.primaryLight};
  }
  &:disabled {
    background: ${colors.gray};
    cursor: not-allowed;
  }
`;
const util = css`
  padding: 5px 10px;
  font-size: 0.85em;
  background: ${colors.grayLight};
  border: 1px solid ${colors.border};
  border-radius: 4px;
  cursor: pointer;
  &:hover {
    background: ${colors.light};
    border-color: ${colors.primary};
  }
`;
const status = css`
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.9em;
`;
const setOk = css`
  ${status};
  background: rgba(76, 201, 176, 0.1);
  color: ${colors.success};
  border: 1px solid ${colors.success};
`;
const setBad = css`
  ${status};
  background: rgba(230, 94, 106, 0.1);
  color: ${colors.danger};
  border: 1px solid ${colors.danger};
`;
const feedOk = css`
  margin-top: 12px;
  padding: 10px;
  border: 1px solid ${colors.success};
  background: rgba(76, 201, 176, 0.15);
  color: ${colors.success};
  border-radius: 4px;
  font-size: 0.95em;
`;
const feedNg = css`
  margin-top: 12px;
  padding: 10px;
  border: 1px solid ${colors.danger};
  background: rgba(230, 94, 106, 0.15);
  color: ${colors.danger};
  border-radius: 4px;
  font-size: 0.95em;
`;
const link = css`
  ${globalLink}
`;

export default function SettingsPage() {
  const { t } = useTranslation();

  const { loading, keySet, saveKey, saveStatus, clearStatus } =
    useSettingsStore();

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const busy = loading || (saveStatus === null ? false : undefined); // disable buttons while saving

  const indicator = loading ? (
    t('common.loading')
  ) : keySet ? (
    <span className={setOk}>{t('settings.keySet')}</span>
  ) : (
    <span className={setBad}>{t('settings.keyNotSet')}</span>
  );

  const handleSave = async () => {
    await saveKey(draft.trim());
    setDraft('');
    setEditing(false);
  };

  const handleRemove = async () => {
    if (!window.confirm(t('settings.openai.confirmRemovePrompt'))) return;
    await saveKey('');
  };

  return (
    <div className={page}>
      <h1 className={h1}>{t('settings.title')}</h1>

      <p className={info}>
        {t('settings.description.para1')}
        <br />
        <br />
        {t('settings.description.para2.part1')}{' '}
        <a
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          className={link}
        >
          {t('settings.description.para2.link')}
        </a>
        .<br />
        <br />
        {t('settings.description.para3')}
      </p>

      <div className={box}>
        <h2 className={h2}>
          {t('settings.openai.sectionTitle')}
          {indicator}
        </h2>

        {/* key already set & not editing */}
        {keySet && !editing && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{t('settings.openai.isSet')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={util}
                onClick={() => {
                  setEditing(true);
                  clearStatus();
                }}
                disabled={busy}
              >
                {t('settings.changeKey')}
              </button>
              <button
                className={util}
                onClick={handleRemove}
                disabled={busy}
                style={{ color: '#dc3545', borderColor: '#dc3545' }}
              >
                {t('settings.removeKey')}
              </button>
            </div>
          </div>
        )}

        {(!keySet || editing) && (
          <>
            <label htmlFor="openai" className={label}>
              {t('settings.openai.apiKeyLabel')}:
            </label>
            <input
              id="openai"
              type="password"
              className={input}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={t('settings.openai.placeholder')}
            />

            <button
              className={btn}
              onClick={handleSave}
              disabled={busy || (!draft.trim() && keySet)}
            >
              {t('common.save')}
            </button>
            {editing && (
              <button
                className={util}
                onClick={() => {
                  setEditing(false);
                  setDraft('');
                  clearStatus();
                }}
                disabled={busy}
              >
                {t('common.cancel')}
              </button>
            )}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className={link}
              style={{ marginLeft: editing ? '0' : 'auto' }}
            >
              {t('settings.getKey', { name: 'OpenAI' })}
            </a>
          </>
        )}

        {saveStatus && (
          <p className={saveStatus.ok ? feedOk : feedNg} role="status">
            {saveStatus.msg}
          </p>
        )}
      </div>
    </div>
  );
}

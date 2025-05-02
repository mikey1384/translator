import { useState, useEffect } from 'react';
import { css } from '@emotion/css';
import { colors, linkStyles as globalLinkStyles } from '../styles.js';
import { useTranslation } from 'react-i18next';

const settingsPageStyles = css`
  padding: 30px;
  max-width: 700px;
  margin: 20px auto;
  background-color: ${colors.white};
  border-radius: 8px;
  border: 1px solid ${colors.border};
`;

const titleStyles = css`
  font-size: 1.8em;
  color: ${colors.dark};
  margin-bottom: 25px;
  border-bottom: 1px solid ${colors.border};
  padding-bottom: 15px;
`;

const sectionStyles = css`
  margin-bottom: 35px;
  padding: 20px;
  background-color: ${colors.light};
  border: 1px solid ${colors.border};
  border-radius: 6px;
`;

const sectionTitleStyles = css`
  font-size: 1.3em;
  color: ${colors.dark};
  margin-bottom: 20px;
`;

const labelStyles = css`
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: ${colors.grayDark};
`;

const inputStyles = css`
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
`;

const buttonStyles = css`
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
`;

const statusIndicatorStyles = css`
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.9em;
  margin-left: 15px;
  vertical-align: middle;
`;

const statusSetStyles = css`
  background-color: rgba(76, 201, 176, 0.1);
  color: ${colors.success};
  border: 1px solid ${colors.success};
`;

const statusNotSetStyles = css`
  background-color: rgba(230, 94, 106, 0.1);
  color: ${colors.danger};
  border: 1px solid ${colors.danger};
`;

const feedbackMessageStyles = css`
  margin-top: 15px;
  padding: 10px;
  border-radius: 4px;
  font-size: 0.95em;
`;

const successMessageStyles = css`
  background-color: rgba(76, 201, 176, 0.15);
  color: ${colors.success};
  border: 1px solid ${colors.success};
`;

const errorMessageStyles = css`
  background-color: rgba(230, 94, 106, 0.15);
  color: ${colors.danger};
  border: 1px solid ${colors.danger};
`;

const linkStyles = css`
  ${globalLinkStyles}// Use global link style
`;

const infoTextStyles = css`
  font-size: 0.9em;
  color: ${colors.grayDark}; // Secondary light text
  margin-top: 10px;
  margin-bottom: 15px;
  line-height: 1.4;
`;

type ApiKeyStatus = {
  openai: boolean;
} | null;

type SaveStatus = {
  type: 'openai';
  success: boolean;
  message: string;
} | null;

interface SettingsPageProps {
  apiKeyStatus: ApiKeyStatus;
  isLoadingStatus: boolean;
}

const keySetInfoStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 15px;
  background-color: ${colors.light};
  border: 1px solid ${colors.border};
  border-radius: 4px;
  margin-bottom: 15px;
`;

const keySetTextStyles = css`
  font-weight: 500;
  color: ${colors.dark}; // Light text
`;

const keyActionButtonsStyles = css`
  display: flex;
  gap: 8px;
`;

const utilityButtonStyles = css`
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
`;

function SettingsPage({ apiKeyStatus, isLoadingStatus }: SettingsPageProps) {
  const { t } = useTranslation();
  const [openaiKeyInput, setOpenaiKeyInput] = useState('');
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus>(apiKeyStatus);
  const [loadingStatus, setLoadingStatus] = useState(isLoadingStatus);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [isEditingOpenAI, setIsEditingOpenAI] = useState(false);

  useEffect(() => {
    setKeyStatus(apiKeyStatus);
  }, [apiKeyStatus]);

  useEffect(() => {
    setLoadingStatus(isLoadingStatus);
  }, [isLoadingStatus]);

  const handleSaveKey = async () => {
    const apiKey = openaiKeyInput;
    setIsSaving(true);
    setSaveStatus(null); // Clear previous status

    try {
      const result = await window.electron.saveApiKey('openai', apiKey);
      if (result.success) {
        setSaveStatus({
          type: 'openai',
          success: true,
          message: apiKey
            ? t('settings.openai.saveSuccess')
            : t('settings.openai.removeSuccess'),
        });
        setKeyStatus(prevStatus => ({
          ...prevStatus!,
          openai: !!apiKey,
        }));
        setOpenaiKeyInput('');
        setIsEditingOpenAI(false);
      } else {
        setSaveStatus({
          type: 'openai',
          success: false,
          message: result.error || t('settings.openai.saveError'),
        });
      }
    } catch (error) {
      console.error('Error calling saveApiKey for openai:', error);
      setSaveStatus({
        type: 'openai',
        success: false,
        message: t('common.error.unexpected'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveKey = async () => {
    // Add confirmation dialog at the beginning
    if (!window.confirm(t('settings.openai.confirmRemovePrompt'))) {
      console.log('OpenAI key removal cancelled by user.');
      return;
    }

    console.log('Attempting to remove OpenAI key...');
    setSaveStatus(null);
    setIsSaving(true);

    try {
      console.log('Calling saveApiKey to remove openai key...');
      const result = await window.electron.saveApiKey('openai', '');
      console.log('Result from saveApiKey for removing openai:', result);

      if (result.success) {
        console.log('Key removal success for openai. Updating state...');
        setSaveStatus({
          type: 'openai',
          success: true,
          message: t('settings.openai.removeSuccess'),
        });
        console.log('Updating keyStatus for openai to false.');
        setKeyStatus(prevStatus => {
          const newState = { ...prevStatus!, openai: false };
          console.log('New keyStatus state (after removal):', newState);
          return newState;
        });
        setIsEditingOpenAI(false);
      } else {
        console.error('Key removal failed for openai:', result.error);
        setSaveStatus({
          type: 'openai',
          success: false,
          message: result.error || t('settings.openai.removeError'),
        });
      }
    } catch (error) {
      console.error('Error calling saveApiKey to remove openai key:', error);
      setSaveStatus({
        type: 'openai',
        success: false,
        message: t('common.error.unexpectedRemove'),
      });
    } finally {
      setIsSaving(false);
      console.log('Finished handleRemoveKey for openai.');
    }
  };

  const renderStatusIndicator = (isSet: boolean | undefined) => {
    if (loadingStatus)
      return (
        <span className={statusIndicatorStyles}>{t('common.loading')}</span>
      );
    if (isSet === undefined) return null; // Status not yet loaded

    return (
      <span
        className={css`
          ${statusIndicatorStyles} ${isSet
            ? statusSetStyles
            : statusNotSetStyles}
        `}
      >
        {isSet ? t('settings.keySet') : t('settings.keyNotSet')}
      </span>
    );
  };

  const renderFeedbackMessage = () => {
    if (!saveStatus) return null;

    return (
      <p
        className={css`
          ${feedbackMessageStyles} ${saveStatus.success
            ? successMessageStyles
            : errorMessageStyles}
        `}
      >
        {saveStatus.message}
      </p>
    );
  };

  const renderOpenAIKeySection = () => {
    const isSet = keyStatus ? keyStatus.openai : false;
    const isEditing = isEditingOpenAI;
    const currentInputValue = openaiKeyInput;
    const setInputValue = setOpenaiKeyInput;
    const setIsEditing = setIsEditingOpenAI;
    const placeholder = t('settings.openai.placeholder');
    const getName = 'OpenAI';
    const getKeyLink = 'https://platform.openai.com/api-keys';

    if (loadingStatus) {
      return <p>{t('settings.loadingStatus')}</p>;
    }

    if (isSet && !isEditing) {
      return (
        <div className={keySetInfoStyles}>
          <span className={keySetTextStyles}>{t('settings.openai.isSet')}</span>
          <div className={keyActionButtonsStyles}>
            <button
              className={utilityButtonStyles}
              onClick={() => setIsEditing(true)}
              disabled={isSaving}
            >
              {t('settings.changeKey')}
            </button>
            <button
              className={css`
                ${utilityButtonStyles} ${css`
                  color: #dc3545;
                  border-color: #dc3545;
                  &:hover {
                    background-color: #f8d7da;
                  }
                `}
              `}
              onClick={handleRemoveKey}
              disabled={isSaving}
            >
              {t('settings.removeKey')}
            </button>
          </div>
        </div>
      );
    } else {
      return (
        <>
          <label htmlFor="openai-key" className={labelStyles}>
            {t('settings.openai.apiKeyLabel')}:
          </label>
          <input
            id="openai-key"
            type="password"
            className={inputStyles}
            value={currentInputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder={placeholder}
            disabled={isSaving}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              className={buttonStyles}
              onClick={handleSaveKey}
              disabled={isSaving || (!currentInputValue && !isSet)}
            >
              {isSaving
                ? t('common.saving')
                : isEditing
                  ? t('settings.saveChanges')
                  : t('settings.saveKey', { name: getName })}
            </button>
            {isEditing && (
              <button
                className={utilityButtonStyles}
                onClick={() => {
                  setIsEditing(false);
                  setInputValue(''); // Clear input on cancel
                  setSaveStatus(null); // Clear any previous save messages
                }}
                disabled={isSaving}
              >
                {t('common.cancel')}
              </button>
            )}
            <a
              href={getKeyLink}
              target="_blank"
              rel="noopener noreferrer"
              className={linkStyles}
              style={{ marginLeft: isEditing ? '0' : 'auto' }} // Adjust margin
            >
              {t('settings.getKey', { name: getName })}
            </a>
          </div>
          {renderFeedbackMessage()}
        </>
      );
    }
  };

  return (
    <div className={settingsPageStyles}>
      <h1 className={titleStyles}>{t('settings.title')}</h1>
      <p className={infoTextStyles}>
        {t('settings.description.para1')}
        <br />
        <br />
        {t('settings.description.para2.part1')}{' '}
        <a
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          className={linkStyles}
        >
          {t('settings.description.para2.link')}
        </a>
        .
        <br />
        <br />
        {t('settings.description.para3')}
      </p>

      <div className={sectionStyles}>
        <h2 className={sectionTitleStyles}>
          {t('settings.openai.sectionTitle')}
          {renderStatusIndicator(keyStatus?.openai)}
        </h2>
        {renderOpenAIKeySection()}
      </div>
    </div>
  );
}

export default SettingsPage;

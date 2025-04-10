import { useState, useEffect } from 'react';
import { css } from '@emotion/css';
import { colors, linkStyles as globalLinkStyles } from '../styles.js';

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
  onBack: () => void;
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

const backButtonStyles = css`
  padding: 8px 16px;
  font-size: 0.9rem;
  background-color: ${colors.light};
  color: ${colors.dark};
  border: 1px solid ${colors.border};
  border-radius: 6px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  box-shadow: none;
  margin-bottom: 20px;
  align-self: flex-start;

  &:hover {
    background-color: ${colors.light};
    border-color: ${colors.primary};
    color: ${colors.dark};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background-color: ${colors.grayLight};
    border-color: ${colors.border};
    color: ${colors.gray};
  }

  // Ensure it doesn't take full width on mobile like standard buttons might
  @media (max-width: 768px) {
    width: auto !important;
  }
`;

function SettingsPage({
  onBack,
  apiKeyStatus,
  isLoadingStatus,
}: SettingsPageProps) {
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
            ? 'OpenAI key saved successfully!'
            : 'OpenAI key removed successfully!',
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
          message: result.error || 'Failed to save key.',
        });
      }
    } catch (error) {
      console.error('Error calling saveApiKey for openai:', error);
      setSaveStatus({
        type: 'openai',
        success: false,
        message: 'An unexpected error occurred.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveKey = async () => {
    if (
      !window.confirm('Are you sure you want to remove the OpenAI API key?')
    ) {
      return;
    }

    setIsSaving(true);
    setSaveStatus(null);

    try {
      console.log('[SettingsPage] Calling saveApiKey to remove openai key...');
      const result = await window.electron.saveApiKey('openai', '');
      console.log(
        '[SettingsPage] Result from saveApiKey for removing openai:',
        result
      );

      if (result.success) {
        console.log(
          '[SettingsPage] Key removal success for openai. Updating state...'
        );
        setSaveStatus({
          type: 'openai',
          success: true,
          message: 'OpenAI key removed successfully!',
        });
        console.log('[SettingsPage] Updating keyStatus for openai to false.');
        setKeyStatus(prevStatus => {
          const newState = { ...prevStatus!, openai: false };
          console.log(
            '[SettingsPage] New keyStatus state (after removal):',
            newState
          );
          return newState;
        });
        setIsEditingOpenAI(false);
      } else {
        console.error(
          '[SettingsPage] Key removal failed for openai:',
          result.error
        );
        setSaveStatus({
          type: 'openai',
          success: false,
          message: result.error || 'Failed to remove key.',
        });
      }
    } catch (error) {
      console.error(
        '[SettingsPage] Error calling saveApiKey to remove openai key:',
        error
      );
      setSaveStatus({
        type: 'openai',
        success: false,
        message: 'An unexpected error occurred while removing the key.',
      });
    } finally {
      setIsSaving(false);
      console.log('[SettingsPage] Finished handleRemoveKey for openai.');
    }
  };

  const renderStatusIndicator = (isSet: boolean | undefined) => {
    if (loadingStatus)
      return <span className={statusIndicatorStyles}>Loading...</span>;
    if (isSet === undefined) return null; // Status not yet loaded

    return (
      <span
        className={css`
          ${statusIndicatorStyles} ${isSet
            ? statusSetStyles
            : statusNotSetStyles}
        `}
      >
        {isSet ? 'Key Set' : 'Key Not Set'}
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
    const placeholder = 'Enter your OpenAI key (sk-...)';
    const getName = 'OpenAI';
    const getKeyLink = 'https://platform.openai.com/api-keys';

    if (loadingStatus) {
      return <p>Loading key status...</p>;
    }

    if (isSet && !isEditing) {
      return (
        <div className={keySetInfoStyles}>
          <span className={keySetTextStyles}>{getName} API Key is Set</span>
          <div className={keyActionButtonsStyles}>
            <button
              className={utilityButtonStyles}
              onClick={() => setIsEditing(true)}
              disabled={isSaving}
            >
              Change Key
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
              Remove Key
            </button>
          </div>
        </div>
      );
    } else {
      return (
        <>
          <label htmlFor="openai-key" className={labelStyles}>
            {getName} API Key:
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
                ? 'Saving...'
                : isEditing
                  ? 'Save Changes'
                  : `Save ${getName} Key`}
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
                Cancel
              </button>
            )}
            <a
              href={getKeyLink}
              target="_blank"
              rel="noopener noreferrer"
              className={linkStyles}
              style={{ marginLeft: isEditing ? '0' : 'auto' }} // Adjust margin
            >
              Get {getName} Key
            </a>
          </div>
          {renderFeedbackMessage()}
        </>
      );
    }
  };

  return (
    <div className={settingsPageStyles}>
      <button className={backButtonStyles} onClick={onBack} disabled={isSaving}>
        &larr; Back to Main App
      </button>

      <h1 className={titleStyles}>API Key Settings</h1>
      <p className={infoTextStyles}>
        Enter your personal API key for OpenAI (GPT models) below.
        <br />
        This key is stored securely on your computer using the system&apos;s
        keychain and is never shared.
      </p>

      <div className={sectionStyles}>
        <h2 className={sectionTitleStyles}>
          OpenAI (GPT models)
          {renderStatusIndicator(keyStatus?.openai)}
        </h2>
        {renderOpenAIKeySection()}
      </div>
    </div>
  );
}

export default SettingsPage;

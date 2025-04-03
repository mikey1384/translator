import { useState, useEffect, useCallback } from 'react';
import { css } from '@emotion/css';

// Basic Styling using @emotion/css
const settingsPageStyles = css`
  padding: 30px;
  max-width: 700px;
  margin: 20px auto;
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
`;

const titleStyles = css`
  font-size: 1.8em;
  color: #333;
  margin-bottom: 25px;
  border-bottom: 1px solid #eee;
  padding-bottom: 15px;
`;

const sectionStyles = css`
  margin-bottom: 35px;
  padding: 20px;
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
`;

const sectionTitleStyles = css`
  font-size: 1.3em;
  color: #444;
  margin-bottom: 20px;
`;

const labelStyles = css`
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: #555;
`;

const inputStyles = css`
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1em;
  box-sizing: border-box; /* Ensure padding doesn't increase width */
  margin-bottom: 15px;
`;

const buttonStyles = css`
  padding: 10px 18px;
  background-color: #4a90e2; // A nice blue
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1em;
  transition: background-color 0.2s ease;
  margin-right: 10px;

  &:hover {
    background-color: #357abd;
  }

  &:disabled {
    background-color: #ccc;
    cursor: not-allowed;
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
  background-color: #d4edda; // Light green
  color: #155724;
  border: 1px solid #c3e6cb;
`;

const statusNotSetStyles = css`
  background-color: #f8d7da; // Light red
  color: #721c24;
  border: 1px solid #f5c6cb;
`;

const feedbackMessageStyles = css`
  margin-top: 15px;
  padding: 10px;
  border-radius: 4px;
  font-size: 0.95em;
`;

const successMessageStyles = css`
  background-color: #e6ffed;
  color: #006421;
  border: 1px solid #c1f0d0;
`;

const errorMessageStyles = css`
  background-color: #fff0f1;
  color: #a30011;
  border: 1px solid #ffccd1;
`;

const linkStyles = css`
  color: #4a90e2;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

const infoTextStyles = css`
  font-size: 0.9em;
  color: #666;
  margin-top: 10px;
  margin-bottom: 15px;
  line-height: 1.4;
`;

type KeyStatus = {
  openai: boolean;
  anthropic: boolean;
};

type SaveStatus = {
  type: 'openai' | 'anthropic';
  success: boolean;
  message: string;
} | null;

// <<< Define Props Interface >>>
interface SettingsPageProps {
  onBack: () => void;
}

function SettingsPage({ onBack }: SettingsPageProps) {
  const [openaiKeyInput, setOpenaiKeyInput] = useState('');
  const [anthropicKeyInput, setAnthropicKeyInput] = useState('');
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fetchKeyStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const result = await window.electron.getApiKeyStatus();
      if (result.success) {
        setKeyStatus(result.status);
      } else {
        console.error('Failed to fetch key status:', result.error);
        setKeyStatus({ openai: false, anthropic: false }); // Assume not set on error
      }
    } catch (error) {
      console.error('Error calling getApiKeyStatus:', error);
      setKeyStatus({ openai: false, anthropic: false });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchKeyStatus();
  }, [fetchKeyStatus]);

  const handleSaveKey = async (keyType: 'openai' | 'anthropic') => {
    const apiKey = keyType === 'openai' ? openaiKeyInput : anthropicKeyInput;
    if (!apiKey) {
      setSaveStatus({
        type: keyType,
        success: false,
        message: 'API Key cannot be empty.',
      });
      return;
    }

    setIsSaving(true);
    setSaveStatus(null); // Clear previous status

    try {
      const result = await window.electron.saveApiKey(keyType, apiKey);
      if (result.success) {
        setSaveStatus({
          type: keyType,
          success: true,
          message: `${
            keyType === 'openai' ? 'OpenAI' : 'Anthropic'
          } key saved successfully!`,
        });
        // Update local status immediately
        setKeyStatus(prevStatus => ({
          ...prevStatus!,
          [keyType]: true,
        }));
        // Clear input field on success
        if (keyType === 'openai') setOpenaiKeyInput('');
        if (keyType === 'anthropic') setAnthropicKeyInput('');
      } else {
        setSaveStatus({
          type: keyType,
          success: false,
          message: result.error || 'Failed to save key.',
        });
      }
    } catch (error) {
      console.error(`Error calling saveApiKey for ${keyType}:`, error);
      setSaveStatus({
        type: keyType,
        success: false,
        message: 'An unexpected error occurred while saving the key.',
      });
    } finally {
      setIsSaving(false);
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

  const renderFeedbackMessage = (keyType: 'openai' | 'anthropic') => {
    if (!saveStatus || saveStatus.type !== keyType) return null;

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

  return (
    <div className={settingsPageStyles}>
      {/* <<< Add Back button >>> */}
      <button
        className={css`
          ${buttonStyles}
          background-color: #6c757d; // Grey color
          margin-bottom: 20px;
          &:hover {
            background-color: #5a6268;
          }
        `}
        onClick={onBack}
        disabled={isSaving} // Disable while saving either key
      >
        &larr; Back to Main App
      </button>

      <h1 className={titleStyles}>API Key Settings</h1>
      <p className={infoTextStyles}>
        Enter your personal API keys for OpenAI and Anthropic (Claude) below.
        <br />
        These keys are stored securely on your computer using the system&apos;s
        keychain and are never shared.
      </p>

      {/* OpenAI Section */}
      <div className={sectionStyles}>
        <h2 className={sectionTitleStyles}>
          OpenAI (GPT models)
          {renderStatusIndicator(keyStatus?.openai)}
        </h2>
        <label htmlFor="openai-key" className={labelStyles}>
          OpenAI API Key:
        </label>
        <input
          id="openai-key"
          type="password"
          className={inputStyles}
          value={openaiKeyInput}
          onChange={e => setOpenaiKeyInput(e.target.value)}
          placeholder="Enter your OpenAI key (sk-...)"
          disabled={isSaving}
        />
        <button
          className={buttonStyles}
          onClick={() => handleSaveKey('openai')}
          disabled={isSaving || !openaiKeyInput}
        >
          {isSaving && saveStatus?.type === 'openai'
            ? 'Saving...'
            : 'Save OpenAI Key'}
        </button>
        <a
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          className={linkStyles}
        >
          Get OpenAI Key
        </a>
        {renderFeedbackMessage('openai')}
      </div>

      {/* Anthropic Section */}
      <div className={sectionStyles}>
        <h2 className={sectionTitleStyles}>
          Anthropic (Claude models)
          {renderStatusIndicator(keyStatus?.anthropic)}
        </h2>
        <label htmlFor="anthropic-key" className={labelStyles}>
          Anthropic API Key:
        </label>
        <input
          id="anthropic-key"
          type="password"
          className={inputStyles}
          value={anthropicKeyInput}
          onChange={e => setAnthropicKeyInput(e.target.value)}
          placeholder="Enter your Anthropic key (sk-ant-...)"
          disabled={isSaving}
        />
        <button
          className={buttonStyles}
          onClick={() => handleSaveKey('anthropic')}
          disabled={isSaving || !anthropicKeyInput}
        >
          {isSaving && saveStatus?.type === 'anthropic'
            ? 'Saving...'
            : 'Save Anthropic Key'}
        </button>
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          className={linkStyles}
        >
          Get Anthropic Key
        </a>
        {renderFeedbackMessage('anthropic')}
      </div>
    </div>
  );
}

export default SettingsPage;

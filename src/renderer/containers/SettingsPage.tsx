import React, { useState, useEffect } from 'react';
import { css } from '@emotion/css';
// Assuming Button component exists

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

// Define Key Status Type (can be shared or redefined if needed)
type ApiKeyStatus = {
  openai: boolean;
  anthropic: boolean;
} | null;

type SaveStatus = {
  type: 'openai' | 'anthropic';
  success: boolean;
  message: string;
} | null;

// <<< Define Props Interface >>>
interface SettingsPageProps {
  onBack: () => void;
  apiKeyStatus: ApiKeyStatus;
  isLoadingStatus: boolean;
}

// Add styles for the key status area when key is set
const keySetInfoStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 15px;
  background-color: #e6f7ff; // Light blue background
  border: 1px solid #b3e0ff;
  border-radius: 4px;
  margin-bottom: 15px;
`;

const keySetTextStyles = css`
  font-weight: 500;
  color: #0056b3; // Darker blue text
`;

const keyActionButtonsStyles = css`
  display: flex;
  gap: 8px;
`;

// Small utility button style
const utilityButtonStyles = css`
  padding: 5px 10px;
  font-size: 0.85em;
  background-color: #f8f9fa;
  color: #495057;
  border: 1px solid #ced4da;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  &:hover {
    background-color: #e9ecef;
    border-color: #adb5bd;
  }
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

function SettingsPage({
  onBack,
  apiKeyStatus,
  isLoadingStatus,
}: SettingsPageProps) {
  const [openaiKeyInput, setOpenaiKeyInput] = useState('');
  const [anthropicKeyInput, setAnthropicKeyInput] = useState('');
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus>(apiKeyStatus);
  const [loadingStatus, setLoadingStatus] = useState(isLoadingStatus);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
  const [isSaving, setIsSaving] = useState(false);

  // State to control editing view when key is already set
  const [isEditingOpenAI, setIsEditingOpenAI] = useState(false);
  const [isEditingAnthropic, setIsEditingAnthropic] = useState(false);

  // Update local state if props change (e.g., after returning from background update)
  useEffect(() => {
    setKeyStatus(apiKeyStatus);
  }, [apiKeyStatus]);

  useEffect(() => {
    setLoadingStatus(isLoadingStatus);
  }, [isLoadingStatus]);

  const handleSaveKey = async (keyType: 'openai' | 'anthropic') => {
    const apiKey = keyType === 'openai' ? openaiKeyInput : anthropicKeyInput;
    // Allow saving empty string to effectively remove key via input field
    // if (!apiKey) {
    //   setSaveStatus({ type: keyType, success: false, message: 'API Key cannot be empty.' });
    //   return;
    // }

    setIsSaving(true);
    setSaveStatus(null); // Clear previous status

    try {
      const result = await window.electron.saveApiKey(keyType, apiKey);
      if (result.success) {
        setSaveStatus({
          type: keyType,
          success: true,
          message: apiKey
            ? `${keyType === 'openai' ? 'OpenAI' : 'Anthropic'} key saved successfully!`
            : `${keyType === 'openai' ? 'OpenAI' : 'Anthropic'} key removed successfully!`,
        });
        // Update local status immediately
        setKeyStatus(prevStatus => ({
          ...prevStatus!,
          [keyType]: !!apiKey, // Update status based on whether key is truthy
        }));
        // Clear input and hide editing view
        if (keyType === 'openai') {
          setOpenaiKeyInput('');
          setIsEditingOpenAI(false);
        } else {
          setAnthropicKeyInput('');
          setIsEditingAnthropic(false);
        }
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
        message: 'An unexpected error occurred.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Function to handle removing a key directly
  const handleRemoveKey = async (keyType: 'openai' | 'anthropic') => {
    if (
      !window.confirm(`Are you sure you want to remove the ${keyType} API key?`)
    ) {
      return;
    }

    setIsSaving(true);
    setSaveStatus(null);

    try {
      // Call saveApiKey with an empty string
      console.log(
        `[SettingsPage] Calling saveApiKey to remove ${keyType} key...`
      );
      const result = await window.electron.saveApiKey(keyType, '');
      console.log(
        `[SettingsPage] Result from saveApiKey for removing ${keyType}:`,
        result
      );

      if (result.success) {
        console.log(
          `[SettingsPage] Key removal success for ${keyType}. Updating state...`
        );
        setSaveStatus({
          type: keyType,
          success: true,
          message: `${keyType === 'openai' ? 'OpenAI' : 'Anthropic'} key removed successfully!`,
        });
        // Add log before setting state
        console.log(
          `[SettingsPage] Updating keyStatus for ${keyType} to false.`
        );
        setKeyStatus(prevStatus => {
          const newState = { ...prevStatus!, [keyType]: false };
          console.log(
            `[SettingsPage] New keyStatus state (after removal):`,
            newState
          );
          return newState;
        });
        // Ensure editing state is false
        if (keyType === 'openai') setIsEditingOpenAI(false);
        else setIsEditingAnthropic(false);
      } else {
        console.error(
          `[SettingsPage] Key removal failed for ${keyType}:`,
          result.error
        );
        setSaveStatus({
          type: keyType,
          success: false,
          message: result.error || 'Failed to remove key.',
        });
      }
    } catch (error) {
      console.error(
        `[SettingsPage] Error calling saveApiKey to remove ${keyType} key:`,
        error
      );
      setSaveStatus({
        type: keyType,
        success: false,
        message: 'An unexpected error occurred while removing the key.',
      });
    } finally {
      setIsSaving(false);
      console.log(`[SettingsPage] Finished handleRemoveKey for ${keyType}.`);
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

  // Helper to render the input section or the key-set info
  const renderKeySection = (keyType: 'openai' | 'anthropic') => {
    const isSet = keyStatus ? keyStatus[keyType] : false;
    const isEditing =
      keyType === 'openai' ? isEditingOpenAI : isEditingAnthropic;
    const currentInputValue =
      keyType === 'openai' ? openaiKeyInput : anthropicKeyInput;
    const setInputValue =
      keyType === 'openai' ? setOpenaiKeyInput : setAnthropicKeyInput;
    const setIsEditing =
      keyType === 'openai' ? setIsEditingOpenAI : setIsEditingAnthropic;
    const placeholder =
      keyType === 'openai'
        ? 'Enter your OpenAI key (sk-...)'
        : 'Enter your Anthropic key (sk-ant-...)';
    const getName = keyType === 'openai' ? 'OpenAI' : 'Anthropic';
    const getKeyLink =
      keyType === 'openai'
        ? 'https://platform.openai.com/api-keys'
        : 'https://console.anthropic.com/settings/keys';

    if (loadingStatus) {
      return <p>Loading key status...</p>;
    }

    if (isSet && !isEditing) {
      // Key is set, show info and Change/Remove buttons
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
              onClick={() => handleRemoveKey(keyType)}
              disabled={isSaving}
            >
              Remove Key
            </button>
          </div>
        </div>
      );
    } else {
      // Key is not set OR user is editing it
      return (
        <>
          <label htmlFor={`${keyType}-key`} className={labelStyles}>
            {getName} API Key:
          </label>
          <input
            id={`${keyType}-key`}
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
              onClick={() => handleSaveKey(keyType)}
              // Disable save if input is empty AND the key wasn't already set (i.e., initial setup)
              // Allow saving empty string if editing an existing key (to remove it)
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
          {renderFeedbackMessage(keyType)}
        </>
      );
    }
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
        {renderKeySection('openai')}
      </div>

      {/* Anthropic Section */}
      <div className={sectionStyles}>
        <h2 className={sectionTitleStyles}>
          Anthropic (Claude models)
          {renderStatusIndicator(keyStatus?.anthropic)}
        </h2>
        {renderKeySection('anthropic')}
      </div>
    </div>
  );
}

export default SettingsPage;

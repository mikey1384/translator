import { useState, useEffect } from 'react';
import { css } from '@emotion/css';
import { colors, linkStyles as globalLinkStyles } from '../styles';
// Assuming Button component exists

// Basic Styling using @emotion/css - Dark Theme
const settingsPageStyles = css`
  padding: 30px;
  max-width: 700px;
  margin: 20px auto;
  background-color: ${colors.white}; // Main dark background
  border-radius: 8px;
  // box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05); // Remove shadow for flat
  border: 1px solid ${colors.border};
`;

const titleStyles = css`
  font-size: 1.8em;
  color: ${colors.dark}; // Light text
  margin-bottom: 25px;
  border-bottom: 1px solid ${colors.border};
  padding-bottom: 15px;
`;

const sectionStyles = css`
  margin-bottom: 35px;
  padding: 20px;
  background-color: ${colors.light}; // Secondary dark bg
  border: 1px solid ${colors.border};
  border-radius: 6px;
`;

const sectionTitleStyles = css`
  font-size: 1.3em;
  color: ${colors.dark}; // Light text
  margin-bottom: 20px;
`;

const labelStyles = css`
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: ${colors.grayDark}; // Secondary light text
`;

const inputStyles = css`
  width: 100%;
  padding: 10px 12px;
  border: 1px solid ${colors.border};
  border-radius: 4px;
  font-size: 1em;
  box-sizing: border-box; /* Ensure padding doesn't increase width */
  margin-bottom: 15px;
  background-color: ${colors.grayLight}; // Surface color for inputs
  color: ${colors.dark}; // Light text
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
  background-color: ${colors.primary}; // Use primary accent
  color: white;
  border: none; // Maybe a subtle border? 1px solid ${colors.primaryDark}
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

// Use styles from global theme file if they exist and match
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

// Add styles for the key status area when key is set - Dark Theme
const keySetInfoStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 15px;
  background-color: ${colors.light}; // Use secondary dark bg
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

// Small utility button style - Dark Theme
const utilityButtonStyles = css`
  padding: 5px 10px;
  font-size: 0.85em;
  background-color: ${colors.grayLight}; // Surface color
  color: ${colors.dark}; // Light text
  border: 1px solid ${colors.border};
  border-radius: 4px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  box-shadow: none;

  &:hover {
    background-color: ${colors.light}; // Secondary dark bg
    border-color: ${colors.primary}; // Primary accent
  }
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

// Back Button - Style adjusted for Dark Theme consistency
const backButtonStyles = css`
  // Inherit some basic properties if needed, or define directly
  padding: 8px 16px; // Adjust padding if necessary
  font-size: 0.9rem;
  background-color: ${colors.light}; // Match section background
  color: ${colors.dark}; // Light text
  border: 1px solid ${colors.border}; // Standard border
  border-radius: 6px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  box-shadow: none;
  margin-bottom: 20px; // Keep margin
  align-self: flex-start; // Keep alignment

  &:hover {
    background-color: ${colors.light}; // Keep background same on hover
    border-color: ${colors.primary}; // Highlight border on hover
    color: ${colors.dark}; // Keep text color same
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background-color: ${colors.grayLight}; // Slightly different disabled bg
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
      {/* <<< Update Back button to use specific style >>> */}
      <button
        className={backButtonStyles}
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

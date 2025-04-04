const keytar = require('keytar');

// Define the service name used for storing credentials
const SERVICE_NAME = 'TranslatorApp';

async function handleGetApiKeyStatus() {
  try {
    const openAIKey = await keytar.getPassword(SERVICE_NAME, 'openai');
    const anthropicKey = await keytar.getPassword(SERVICE_NAME, 'anthropic');
    const status = {
      openai: !!openAIKey,
      anthropic: !!anthropicKey,
    };
    return { success: true, status };
  } catch (error) {
    console.error('[handleGetApiKeyStatus] Error:', error);
    // Avoid exposing error details potentially containing sensitive info
    return {
      success: false,
      error: 'Failed to retrieve key status.',
      status: { openai: false, anthropic: false },
    };
  }
}

async function handleSaveApiKey(_event, { keyType, apiKey }) {
  // Adjust validation: Allow empty string for deletion, but not null/undefined
  if (!keyType || typeof apiKey === 'undefined' || apiKey === null) {
    return { success: false, error: 'Key type and API key are required.' };
  }
  if (keyType !== 'openai' && keyType !== 'anthropic') {
    return { success: false, error: 'Invalid key type specified.' };
  }

  try {
    if (apiKey === '') {
      // --- Deletion Logic ---
      const deleted = await keytar.deletePassword(SERVICE_NAME, keyType);
      // Consider deletion success even if the key wasn't there initially
      return { success: true };
    } else {
      // --- Saving Logic ---
      // Basic validation (example: check prefix)
      if (keyType === 'openai' && !apiKey.startsWith('sk-')) {
        return { success: false, error: 'Invalid OpenAI key format.' };
      }
      // Add similar check for Anthropic if needed

      await keytar.setPassword(SERVICE_NAME, keyType, apiKey);
      return { success: true };
    }
  } catch (error) {
    console.error(`[handleSaveApiKey] Error for ${keyType}:`, error);
    // Avoid exposing error details potentially containing sensitive info
    return { success: false, error: 'Failed to save API key.' };
  }
}

module.exports = {
  handleGetApiKeyStatus,
  handleSaveApiKey,
};

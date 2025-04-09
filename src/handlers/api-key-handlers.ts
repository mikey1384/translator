import { IpcMainInvokeEvent } from 'electron';
import log from 'electron-log';
import { getApiKey, saveApiKey } from '../services/secure-store.js';

// Define interfaces for API key status and results
interface ApiKeyStatus {
  openai: boolean;
  anthropic: boolean;
}

interface ApiKeyResult {
  success: boolean;
  status?: ApiKeyStatus;
  error?: string;
}

interface SaveApiKeyOptions {
  keyType: 'openai' | 'anthropic';
  apiKey: string; // Empty string means delete
}

interface SaveApiKeyResult {
  success: boolean;
  error?: string;
}

export async function handleGetApiKeyStatus(
  _event: IpcMainInvokeEvent
): Promise<ApiKeyResult> {
  log.info('[api-key-handler] Received get-api-key-status request');
  try {
    // Use secure-store instead of keytar
    const status: ApiKeyStatus = {
      openai: false,
      anthropic: false,
    };
    const openaiKey = await getApiKey('openai');
    const anthropicKey = await getApiKey('anthropic');
    status.openai = !!openaiKey;
    status.anthropic = !!anthropicKey;

    log.info('[api-key-handler] Key status retrieved', status);
    return { success: true, status };
  } catch (error: any) {
    log.error('[api-key-handler] Error getting API key status:', error);
    // Do not expose raw error details to the renderer
    return {
      success: false,
      error: 'Failed to retrieve API key status.',
    };
  }
}

export async function handleSaveApiKey(
  _event: IpcMainInvokeEvent,
  options: SaveApiKeyOptions
): Promise<SaveApiKeyResult> {
  log.info('[api-key-handler] Received save-api-key request', {
    keyType: options?.keyType,
  });
  if (!options || !options.keyType || typeof options.apiKey !== 'string') {
    log.warn('[api-key-handler] Invalid options received for save-api-key');
    return { success: false, error: 'Invalid options provided.' };
  }

  const { keyType, apiKey } = options;

  // Validate keyType
  if (keyType !== 'openai' && keyType !== 'anthropic') {
    log.warn(`[api-key-handler] Invalid key type: ${keyType}`);
    return { success: false, error: 'Invalid key type specified.' };
  }

  try {
    // Use secure-store instead of keytar
    if (apiKey === '') {
      await saveApiKey(keyType, '');
      log.info(`[api-key-handler] API key for ${keyType} deleted.`);
    } else {
      // Basic format check (example: OpenAI starts with sk-)
      if (keyType === 'openai' && !apiKey.startsWith('sk-')) {
        log.warn('[api-key-handler] Invalid OpenAI key format detected.');
        return { success: false, error: 'Invalid OpenAI key format.' };
      }
      // Add similar check for Anthropic if applicable
      await saveApiKey(keyType, apiKey);
      log.info(`[api-key-handler] API key for ${keyType} saved.`);
    }
    return { success: true };
  } catch (error: any) {
    log.error(`[api-key-handler] Error saving API key for ${keyType}:`, error);
    return {
      success: false,
      error: `Failed to save API key for ${keyType}.`,
    };
  }
}

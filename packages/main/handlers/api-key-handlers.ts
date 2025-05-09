import { IpcMainInvokeEvent } from 'electron';
import log from 'electron-log';
import { getApiKey, saveApiKey } from '../services/secure-store.js';

interface ApiKeyStatus {
  openai: boolean;
}

interface ApiKeyResult {
  success: boolean;
  status?: ApiKeyStatus;
  error?: string;
}

interface SaveApiKeyOptions {
  keyType: 'openai';
  apiKey: string;
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
    const status: ApiKeyStatus = {
      openai: false,
    };
    const openaiKey = await getApiKey('openai');
    status.openai = !!openaiKey;

    log.info('[api-key-handler] Key status retrieved', status);
    return { success: true, status };
  } catch (error: any) {
    log.error('[api-key-handler] Error getting API key status:', error);
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

  try {
    if (apiKey === '') {
      await saveApiKey(keyType, '');
      log.info(`[api-key-handler] API key for ${keyType} deleted.`);
    } else {
      if (keyType === 'openai' && !apiKey.startsWith('sk-')) {
        log.warn('[api-key-handler] Invalid OpenAI key format detected.');
        return { success: false, error: 'Invalid OpenAI key format.' };
      }
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

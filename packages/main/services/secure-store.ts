import Store from 'electron-store';
import pkg from 'node-machine-id';
const { machineIdSync } = pkg;
import crypto from 'crypto';
import log from 'electron-log';

interface ApiKeys {
  openai?: string;
}

function generateEncryptionKey(): string {
  try {
    const machineId = machineIdSync();

    const hash = crypto
      .createHash('sha256')
      .update(`TranslatorApp-${machineId}`)
      .digest('hex');

    return hash.substring(0, 32);
  } catch (error) {
    log.error('[secure-store] Error generating encryption key:', error);
    return 'TranslatorApp-DefaultEncryptionKey';
  }
}

const secureStore = new Store<{
  apiKeys?: ApiKeys;
}>({
  name: 'secure-store',
  encryptionKey: generateEncryptionKey(),
});

const API_KEYS_KEY = 'apiKeys';

export async function getApiKey(keyType: 'openai'): Promise<string | null> {
  try {
    const apiKeys = secureStore.get(API_KEYS_KEY) as ApiKeys | undefined;
    return apiKeys?.[keyType] || null;
  } catch (error) {
    log.error(`[secure-store] Error getting API key for ${keyType}:`, error);
    return null;
  }
}

export async function saveApiKey(
  keyType: 'openai',
  apiKey: string
): Promise<void> {
  try {
    const apiKeys = secureStore.get(API_KEYS_KEY) || {};

    if (apiKey === '') {
      delete apiKeys[keyType];
    } else {
      apiKeys[keyType] = apiKey;
    }

    secureStore.set(API_KEYS_KEY, apiKeys);
    log.info(
      `[secure-store] API key for ${keyType} ${apiKey === '' ? 'deleted' : 'saved'}`
    );
  } catch (error) {
    log.error(`[secure-store] Error saving API key for ${keyType}:`, error);
    throw new Error(`Failed to save API key for ${keyType}`);
  }
}

export async function hasApiKey(keyType: 'openai'): Promise<boolean> {
  const key = await getApiKey(keyType);
  return !!key;
}

export async function migrateFromKeytar(
  keytarService: string,
  getKeytarPassword: (
    service: string,
    account: string
  ) => Promise<string | null>
): Promise<void> {
  try {
    const openaiKey = await getKeytarPassword(keytarService, 'openai');
    if (openaiKey) {
      await saveApiKey('openai', openaiKey);
      log.info('[secure-store] Migrated OpenAI key from keytar');
    }
  } catch (error) {
    log.error('[secure-store] Error during keytar migration:', error);
  }
}

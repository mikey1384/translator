import Store from 'electron-store';
import pkg from 'node-machine-id';
const { machineIdSync } = pkg;
import crypto from 'crypto';
import log from 'electron-log';

// Generate a deterministic encryption key based on machine ID
// This ensures the key is unique per device but remains the same across app restarts
function generateEncryptionKey(): string {
  try {
    // Get a unique machine ID
    const machineId = machineIdSync();

    // Create a hash for better security
    const hash = crypto
      .createHash('sha256')
      .update(`TranslatorApp-${machineId}`)
      .digest('hex');

    return hash.substring(0, 32); // Use first 32 chars (256 bits)
  } catch (error) {
    log.error('[secure-store] Error generating encryption key:', error);
    // Fallback with a less secure but still usable default
    return 'TranslatorApp-DefaultEncryptionKey';
  }
}

// Create secure store with encryption
const secureStore = new Store({
  name: 'secure-store', // Creates secure-store.json in app's user data folder
  encryptionKey: generateEncryptionKey(),
});

// Constants
const API_KEYS_KEY = 'apiKeys';

// Store structure in electron-store
interface ApiKeys {
  openai?: string;
  anthropic?: string;
}

/**
 * Gets a stored API key
 * @param keyType The type of API key ('openai' or 'anthropic')
 * @returns The API key or null if not found
 */
export async function getApiKey(
  keyType: 'openai' | 'anthropic'
): Promise<string | null> {
  try {
    const apiKeys = secureStore.get(API_KEYS_KEY) as ApiKeys | undefined;
    return apiKeys?.[keyType] || null;
  } catch (error) {
    log.error(`[secure-store] Error getting API key for ${keyType}:`, error);
    return null;
  }
}

/**
 * Saves an API key
 * @param keyType The type of API key ('openai' or 'anthropic')
 * @param apiKey The API key to save (pass empty string to delete)
 */
export async function saveApiKey(
  keyType: 'openai' | 'anthropic',
  apiKey: string
): Promise<void> {
  try {
    const apiKeys = (secureStore.get(API_KEYS_KEY) as ApiKeys) || {};

    if (apiKey === '') {
      // Delete the key
      delete apiKeys[keyType];
    } else {
      // Save the key
      apiKeys[keyType] = apiKey;
    }

    // Update the store
    secureStore.set(API_KEYS_KEY, apiKeys);
    log.info(
      `[secure-store] API key for ${keyType} ${apiKey === '' ? 'deleted' : 'saved'}`
    );
  } catch (error) {
    log.error(`[secure-store] Error saving API key for ${keyType}:`, error);
    throw new Error(`Failed to save API key for ${keyType}`);
  }
}

/**
 * Checks if an API key exists
 * @param keyType The type of API key ('openai' or 'anthropic')
 * @returns True if the key exists, false otherwise
 */
export async function hasApiKey(
  keyType: 'openai' | 'anthropic'
): Promise<boolean> {
  const key = await getApiKey(keyType);
  return !!key;
}

// Migration utility to transfer from keytar (optional)
export async function migrateFromKeytar(
  keytarService: string,
  getKeytarPassword: (
    service: string,
    account: string
  ) => Promise<string | null>
): Promise<void> {
  try {
    // Try to migrate OpenAI key
    const openaiKey = await getKeytarPassword(keytarService, 'openai');
    if (openaiKey) {
      await saveApiKey('openai', openaiKey);
      log.info('[secure-store] Migrated OpenAI key from keytar');
    }

    // Try to migrate Anthropic key
    const anthropicKey = await getKeytarPassword(keytarService, 'anthropic');
    if (anthropicKey) {
      await saveApiKey('anthropic', anthropicKey);
      log.info('[secure-store] Migrated Anthropic key from keytar');
    }
  } catch (error) {
    log.error('[secure-store] Error during keytar migration:', error);
  }
}

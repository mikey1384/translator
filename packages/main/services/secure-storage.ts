/**
 * Secure storage using app-level encryption (AES-256-GCM)
 *
 * Uses Node.js crypto with a static app key - no OS Keychain prompts.
 * This is the standard approach used by most Electron apps (VS Code, Cursor, etc.)
 *
 * Security model:
 * - Keys are encrypted at rest (not plain text in config)
 * - Encryption key is derived from app-specific secret + machine ID
 * - Less secure than Keychain (if attacker has file access + app binary)
 * - But no annoying system prompts!
 */
import crypto from 'crypto';
import { machineIdSync } from 'node-machine-id';
import log from 'electron-log';

// Prefix to identify our encrypted values (v2 = app-level encryption)
const ENCRYPTION_PREFIX_V2 = 'enc2:';
// Legacy prefix (v1 = safeStorage/Keychain) - will be migrated
const ENCRYPTION_PREFIX_V1 = 'enc:';

// App-specific secret (combined with machine ID for the actual key)
// This is not a secret per se - it just adds app-specificity to the encryption
const APP_SECRET = 'stage5-translator-2024-secure-key';

// Cache the derived key
let derivedKey: Buffer | null = null;

/**
 * Derive encryption key from app secret + machine ID
 * This makes the encrypted data machine-specific
 */
function getDerivedKey(): Buffer {
  if (derivedKey) return derivedKey;

  try {
    const machineId = machineIdSync();
    // Use PBKDF2 to derive a proper 256-bit key
    derivedKey = crypto.pbkdf2Sync(
      APP_SECRET + machineId,
      'stage5-salt',
      100000,
      32,
      'sha256'
    );
    return derivedKey;
  } catch (err) {
    log.error('[secure-storage] Failed to derive encryption key:', err);
    // Fallback to just app secret if machine ID fails
    derivedKey = crypto.pbkdf2Sync(
      APP_SECRET,
      'stage5-salt',
      100000,
      32,
      'sha256'
    );
    return derivedKey;
  }
}

/**
 * Check if encryption is available - always true with app-level encryption
 */
export function isEncryptionAvailable(): boolean {
  return true;
}

/**
 * Encrypt a string using AES-256-GCM
 * Returns base64-encoded encrypted string with v2 prefix
 */
export function encryptString(value: string): string {
  if (!value) return '';

  try {
    const key = getDerivedKey();
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(value, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encryptedData (all base64)
    const combined = `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
    return ENCRYPTION_PREFIX_V2 + combined;
  } catch (err) {
    log.error('[secure-storage] Encryption failed:', err);
    throw new Error('Failed to encrypt value');
  }
}

/**
 * Decrypt a string from secure storage
 * Handles both v2 (app-level) and v1 (legacy safeStorage) formats
 */
export function decryptString(value: string): string {
  if (!value) return '';

  // Handle v2 format (app-level encryption)
  if (value.startsWith(ENCRYPTION_PREFIX_V2)) {
    try {
      const data = value.slice(ENCRYPTION_PREFIX_V2.length);
      const [ivB64, authTagB64, encryptedB64] = data.split(':');

      if (!ivB64 || !authTagB64 || !encryptedB64) {
        log.warn('[secure-storage] Invalid v2 encrypted format');
        return '';
      }

      const key = getDerivedKey();
      const iv = Buffer.from(ivB64, 'base64');
      const authTag = Buffer.from(authTagB64, 'base64');
      const encrypted = Buffer.from(encryptedB64, 'base64');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      log.error('[secure-storage] Decryption failed:', err);
      return '';
    }
  }

  // Legacy v1 format (safeStorage/Keychain) - treat as invalid
  // User will need to re-enter their keys
  if (value.startsWith(ENCRYPTION_PREFIX_V1)) {
    log.info('[secure-storage] Legacy v1 encrypted key found - needs re-entry');
    return '';
  }

  // Plain text (very old format) - reject
  return '';
}

/**
 * Check if a stored value is encrypted (either v1 or v2)
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;
  return (
    value.startsWith(ENCRYPTION_PREFIX_V2) ||
    value.startsWith(ENCRYPTION_PREFIX_V1)
  );
}

/**
 * Check if value uses the new v2 encryption format
 */
export function isV2Encrypted(value: string): boolean {
  return value?.startsWith(ENCRYPTION_PREFIX_V2) ?? false;
}

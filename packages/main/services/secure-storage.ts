/**
 * Secure storage wrapper using Electron's safeStorage API
 * Uses OS-level encryption (Keychain on macOS, DPAPI on Windows, libsecret on Linux)
 *
 * IMPORTANT: This module ONLY supports encrypted storage. Plain text storage is not allowed.
 */
import { safeStorage } from 'electron';
import log from 'electron-log';

const ENCRYPTION_PREFIX = 'enc:';

/**
 * Check if secure storage encryption is available on this system
 */
export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch (err) {
    log.warn('[secure-storage] Failed to check encryption availability:', err);
    return false;
  }
}

/**
 * Encrypt a string for secure storage
 * Returns base64-encoded encrypted string with prefix
 * @throws Error if encryption is not available
 */
export function encryptString(value: string): string {
  if (!value) return '';

  if (!isEncryptionAvailable()) {
    throw new Error(
      'Encryption not available on this system. API keys cannot be stored securely.'
    );
  }

  const encrypted = safeStorage.encryptString(value);
  return ENCRYPTION_PREFIX + encrypted.toString('base64');
}

/**
 * Decrypt a string from secure storage
 * Only handles encrypted (prefixed) values - legacy values are silently rejected
 * @throws Error if encryption is not available
 */
export function decryptString(value: string): string {
  if (!value) return '';

  // Legacy values are silently rejected (caller will clear and user can re-enter)
  if (!value.startsWith(ENCRYPTION_PREFIX)) {
    return '';
  }

  if (!isEncryptionAvailable()) {
    throw new Error(
      'Encryption not available on this system. Cannot decrypt stored value.'
    );
  }

  const base64Data = value.slice(ENCRYPTION_PREFIX.length);
  const encrypted = Buffer.from(base64Data, 'base64');
  return safeStorage.decryptString(encrypted);
}

/**
 * Check if a stored value is encrypted
 */
export function isEncrypted(value: string): boolean {
  return value?.startsWith(ENCRYPTION_PREFIX) ?? false;
}

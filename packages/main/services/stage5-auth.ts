import axios from 'axios';
import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import { decryptString, encryptString, isEncrypted } from './secure-storage.js';
import { STAGE5_API_URL } from './endpoints.js';
import {
  getStage5VersionHeaders,
  throwIfStage5UpdateRequiredError,
} from './stage5-version-gate.js';

const store = new Store<{
  stage5ApiToken?: string;
  stage5ApiRecoveryToken?: string;
}>({
  name: 'stage5-auth',
});
const deviceIdStore = new Store<{ deviceId?: string }>({
  name: 'device-config',
});

let ensureTokenPromise: Promise<string> | null = null;
let unauthorizedRecoveryPromise: Promise<string> | null = null;
let validatedStage5ApiToken: string | null = null;
const DEVICE_TOKEN_ALREADY_PROVISIONED = 'device-token-already-provisioned';
const LEGACY_DEVICE_BOOTSTRAP_DISABLED = 'legacy-device-bootstrap-disabled';
const MANUAL_RECOVERY_REQUIRED_MESSAGE =
  'Stage5 API credentials are missing locally for an already-provisioned device. Manual recovery is required.';

function getResponseStatus(error: any): number | null {
  const status = error?.response?.status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

function getResponseErrorCode(error: any): string {
  const code = error?.response?.data?.error;
  return typeof code === 'string' ? code.trim() : '';
}

function isRejectedOpaqueTokenError(error: any): boolean {
  const status = getResponseStatus(error);
  return status === 401;
}

function isAlreadyProvisionedError(error: any): boolean {
  return (
    getResponseStatus(error) === 409 &&
    getResponseErrorCode(error) === DEVICE_TOKEN_ALREADY_PROVISIONED
  );
}

function isLegacyBootstrapDisabledError(error: any): boolean {
  return (
    getResponseStatus(error) === 403 &&
    getResponseErrorCode(error) === LEGACY_DEVICE_BOOTSTRAP_DISABLED
  );
}

function isManualRecoveryRequiredResponse(error: any): boolean {
  return (
    isAlreadyProvisionedError(error) || isLegacyBootstrapDisabledError(error)
  );
}

function getDeviceId(): string {
  let id = deviceIdStore.get('deviceId');
  if (!id) {
    id = uuidv4();
    deviceIdStore.set('deviceId', id);
  }
  return id;
}

function readStoredToken(): string | null {
  const raw = store.get('stage5ApiToken');
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  if (!isEncrypted(raw)) {
    store.delete('stage5ApiToken');
    return null;
  }
  const decrypted = decryptString(raw).trim();
  if (!decrypted) {
    store.delete('stage5ApiToken');
    return null;
  }
  return decrypted;
}

function writeStoredToken(apiToken: string): void {
  const trimmed = String(apiToken || '').trim();
  if (!trimmed) {
    store.delete('stage5ApiToken');
    if (validatedStage5ApiToken) {
      validatedStage5ApiToken = null;
    }
    return;
  }
  store.set('stage5ApiToken', encryptString(trimmed));
}

function readStoredRecoveryToken(): string | null {
  const raw = store.get('stage5ApiRecoveryToken');
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  if (!isEncrypted(raw)) {
    const trimmed = raw.trim();
    if (!trimmed) {
      store.delete('stage5ApiRecoveryToken');
      return null;
    }
    store.set('stage5ApiRecoveryToken', encryptString(trimmed));
    return trimmed;
  }
  const decrypted = decryptString(raw).trim();
  if (!decrypted) {
    store.delete('stage5ApiRecoveryToken');
    return null;
  }
  return decrypted;
}

function writeStoredRecoveryToken(recoveryToken: string | null | undefined): void {
  const trimmed = String(recoveryToken || '').trim();
  if (!trimmed) {
    store.delete('stage5ApiRecoveryToken');
    return;
  }
  store.set('stage5ApiRecoveryToken', encryptString(trimmed));
}

function writeStoredCredentials({
  apiToken,
  recoveryToken,
}: {
  apiToken: string;
  recoveryToken?: string | null;
}): void {
  writeStoredToken(apiToken);
  writeStoredRecoveryToken(recoveryToken);
  validatedStage5ApiToken = apiToken.trim() || null;
}

function clearStoredOpaqueStage5ApiToken(): void {
  store.delete('stage5ApiToken');
  validatedStage5ApiToken = null;
}

function buildStage5AuthHeaders(apiToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiToken}`,
    ...getStage5VersionHeaders(),
  };
}

async function recoverWithStoredRecoveryToken({
  deviceId,
  recoveryToken,
}: {
  deviceId: string;
  recoveryToken: string;
}): Promise<string> {
  try {
    const recovered = await requestDeviceCredentials({
      deviceId,
      bearerToken: recoveryToken,
    });
    writeStoredCredentials(recovered);
    return recovered.apiToken;
  } catch (error: any) {
    throwIfStage5UpdateRequiredError({ error, source: 'stage5-api' });
    if (isRejectedOpaqueTokenError(error) || isAlreadyProvisionedError(error)) {
      throw new Error(MANUAL_RECOVERY_REQUIRED_MESSAGE);
    }
    throw error;
  }
}

async function requestDeviceCredentials({
  deviceId,
  bearerToken,
}: {
  deviceId: string;
  bearerToken: string;
}): Promise<{ apiToken: string; recoveryToken: string | null }> {
  const response = await axios.post(
    `${STAGE5_API_URL}/auth/device-token`,
    { deviceId },
    {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        ...getStage5VersionHeaders(),
      },
      timeout: 15_000,
    }
  );

  const apiToken =
    typeof response.data?.apiToken === 'string'
      ? response.data.apiToken.trim()
      : '';
  const recoveryToken =
    typeof response.data?.recoveryToken === 'string' &&
    response.data.recoveryToken.trim()
      ? response.data.recoveryToken.trim()
      : null;

  if (!apiToken) {
    throw new Error('Failed to provision Stage5 API token');
  }

  return { apiToken, recoveryToken };
}

export function clearStoredStage5ApiToken(): void {
  clearStoredOpaqueStage5ApiToken();
  store.delete('stage5ApiRecoveryToken');
  validatedStage5ApiToken = null;
}

export function getStoredStage5ApiToken(): string | null {
  return readStoredToken();
}

export async function ensureStage5ApiToken(): Promise<string> {
  const existing = readStoredToken();
  if (existing) {
    // A valid-looking opaque token is used as-is until the API actually rejects
    // it. Recovery happens on the first 401 rather than by minting new secrets
    // during routine startup.
    validatedStage5ApiToken = existing;
    return existing;
  }

  const recoveryToken = readStoredRecoveryToken();

  if (ensureTokenPromise) {
    return ensureTokenPromise;
  }

  ensureTokenPromise = (async () => {
    const deviceId = getDeviceId();
    try {
      if (recoveryToken) {
        return await recoverWithStoredRecoveryToken({
          deviceId,
          recoveryToken,
        });
      }

      const provisioned = await requestDeviceCredentials({
        deviceId,
        bearerToken: deviceId,
      });
      writeStoredCredentials(provisioned);
      return provisioned.apiToken;
    } catch (error: any) {
      throwIfStage5UpdateRequiredError({ error, source: 'stage5-api' });
      if (isManualRecoveryRequiredResponse(error)) {
        throw new Error(MANUAL_RECOVERY_REQUIRED_MESSAGE);
      }
      throw error;
    }
  })();

  try {
    return await ensureTokenPromise;
  } finally {
    ensureTokenPromise = null;
  }
}

export async function recoverStage5ApiTokenAfterUnauthorized(): Promise<string> {
  if (unauthorizedRecoveryPromise) {
    return unauthorizedRecoveryPromise;
  }

  unauthorizedRecoveryPromise = (async () => {
    clearStoredOpaqueStage5ApiToken();
    return ensureStage5ApiToken();
  })();

  try {
    return await unauthorizedRecoveryPromise;
  } finally {
    unauthorizedRecoveryPromise = null;
  }
}

export async function getStage5AuthHeaders(): Promise<Record<string, string>> {
  return buildStage5AuthHeaders(await ensureStage5ApiToken());
}

export async function withStage5AuthRetry<T>(
  request: (headers: Record<string, string>) => Promise<T>
): Promise<T> {
  try {
    return await request(await getStage5AuthHeaders());
  } catch (error: any) {
    if (!isRejectedOpaqueTokenError(error)) {
      throw error;
    }

    const recoveredToken = await recoverStage5ApiTokenAfterUnauthorized();
    return request(buildStage5AuthHeaders(recoveredToken));
  }
}

export async function withStage5AuthRetryOnResponse<T extends { status: number }>(
  request: (headers: Record<string, string>) => Promise<T>
): Promise<T> {
  const first = await request(await getStage5AuthHeaders());
  if (!isRejectedOpaqueTokenError({ response: { status: first.status } })) {
    return first;
  }

  const recoveredToken = await recoverStage5ApiTokenAfterUnauthorized();
  return request(buildStage5AuthHeaders(recoveredToken));
}

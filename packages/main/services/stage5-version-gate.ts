import { app, BrowserWindow } from 'electron';
import type { AxiosResponse } from 'axios';
import type { UpdateRequiredNotice } from '@shared-types/app';
import { ERROR_CODES } from '../../shared/constants/index.js';

export const STAGE5_APP_VERSION_HEADER = 'X-Stage5-App-Version';
const DEFAULT_DOWNLOAD_URL = 'https://stage5.tools';
const DEFAULT_UPDATE_REQUIRED_MESSAGE =
  'A newer version of Translator is required to continue. Please update the app.';

let pendingUpdateRequiredNotice: UpdateRequiredNotice | null = null;
let lastBroadcastSignature = '';

function signatureForNotice(notice: UpdateRequiredNotice): string {
  return JSON.stringify({
    error: notice.error,
    minVersion: notice.minVersion || '',
    clientVersion: notice.clientVersion || '',
    downloadUrl: notice.downloadUrl || '',
    source: notice.source || '',
    message: notice.message || '',
  });
}

export function getTranslatorAppVersion(): string {
  try {
    const version = app.getVersion().trim();
    return version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function getStage5VersionHeaders(): Record<string, string> {
  return {
    [STAGE5_APP_VERSION_HEADER]: getTranslatorAppVersion(),
  };
}

function normalizeUpdateRequiredNotice(
  raw: any,
  source: UpdateRequiredNotice['source']
): UpdateRequiredNotice {
  const minVersion =
    typeof raw?.minVersion === 'string' && raw.minVersion.trim()
      ? raw.minVersion.trim()
      : undefined;
  const clientVersion =
    typeof raw?.clientVersion === 'string' && raw.clientVersion.trim()
      ? raw.clientVersion.trim()
      : getTranslatorAppVersion();
  const downloadUrl =
    typeof raw?.downloadUrl === 'string' && raw.downloadUrl.trim()
      ? raw.downloadUrl.trim()
      : DEFAULT_DOWNLOAD_URL;
  const message =
    typeof raw?.message === 'string' && raw.message.trim()
      ? raw.message.trim()
      : DEFAULT_UPDATE_REQUIRED_MESSAGE;

  return {
    error: ERROR_CODES.UPDATE_REQUIRED,
    message,
    minVersion,
    clientVersion,
    downloadUrl,
    source,
  };
}

function createUpdateRequiredError(notice: UpdateRequiredNotice): Error {
  const error = new Error(notice.message || DEFAULT_UPDATE_REQUIRED_MESSAGE);
  (error as any).code = ERROR_CODES.UPDATE_REQUIRED;
  (error as any).updateRequired = notice;
  return error;
}

export function getPendingStage5UpdateRequiredNotice(): UpdateRequiredNotice | null {
  return pendingUpdateRequiredNotice;
}

export function emitStage5UpdateRequiredNotice(
  raw: any,
  source: UpdateRequiredNotice['source']
): UpdateRequiredNotice {
  const notice = normalizeUpdateRequiredNotice(raw, source);
  pendingUpdateRequiredNotice = notice;

  const signature = signatureForNotice(notice);
  if (signature === lastBroadcastSignature) {
    return notice;
  }
  lastBroadcastSignature = signature;

  try {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send('update:required', notice);
      }
    });
  } catch {
    // Do nothing - renderer will fetch the pending notice on launch.
  }

  return notice;
}

export function throwIfStage5UpdateRequiredResponse(params: {
  response: Pick<AxiosResponse<any>, 'status' | 'data'>;
  source: UpdateRequiredNotice['source'];
}): void {
  if (params.response.status !== 426) {
    return;
  }

  const notice = emitStage5UpdateRequiredNotice(
    params.response.data,
    params.source
  );
  throw createUpdateRequiredError(notice);
}

export function throwIfStage5UpdateRequiredError(params: {
  error: any;
  source: UpdateRequiredNotice['source'];
}): void {
  if (params.error?.response?.status !== 426) {
    return;
  }

  const notice = emitStage5UpdateRequiredNotice(
    params.error?.response?.data,
    params.source
  );
  throw createUpdateRequiredError(notice);
}

export function isStage5UpdateRequiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as any).code || '').trim();
  const message = String((error as any).message || '')
    .trim()
    .toLowerCase();
  return (
    code === ERROR_CODES.UPDATE_REQUIRED ||
    message.includes('update required') ||
    message.includes('unsupported app version')
  );
}

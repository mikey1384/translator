import type { CreditBalanceResult } from '@shared-types/app';
import Store from 'electron-store';
import { BrowserWindow } from 'electron';
import axios from 'axios';
import log from 'electron-log';
import { v4 as uuidv4 } from 'uuid';
import { syncEntitlements } from '../services/entitlements-manager.js';
import { STAGE5_API_URL } from '../services/endpoints.js';
import {
  withStage5AuthRetry,
  withStage5AuthRetryOnResponse,
} from '../services/stage5-auth.js';
import {
  type CheckoutEntitlement,
  hasUnlockedCheckoutEntitlement,
  normalizeCheckoutEntitlement,
} from '../utils/payment-entitlements.js';
import {
  CREDIT_PACKS,
  CREDITS_PER_AUDIO_HOUR,
  API_TIMEOUTS,
} from '../../shared/constants/index.js';
import { getMainWindow } from '../utils/window.js';
import { settingsStore } from '../store/settings-store.js';
import {
  getStage5VersionHeaders,
  isStage5UpdateRequiredError,
  throwIfStage5UpdateRequiredError,
  throwIfStage5UpdateRequiredResponse,
} from '../services/stage5-version-gate.js';
import { getConfiguredAdminSecret } from '../services/admin-auth.js';

// Generate or retrieve device ID using proper UUID v4
export function getDeviceId(): string {
  const deviceIdStore = new Store<{ deviceId?: string }>({
    name: 'device-config',
  });
  let id = deviceIdStore.get('deviceId');
  if (!id) {
    id = uuidv4(); // ✅ valid RFC 4122 v4
    deviceIdStore.set('deviceId', id);
  }
  return id;
}

function sendNetLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: any
) {
  try {
    const payload = { level, kind: 'network', message, meta };
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('app:log', payload)
    );
  } catch {
    // Do nothing
  }
}
const store = new Store<{ balanceCredits: number; creditsPerHour: number }>({
  name: 'credit-balance',
  defaults: { balanceCredits: 0, creditsPerHour: CREDITS_PER_AUDIO_HOUR },
});

const PACK_CREDITS: Record<'MICRO' | 'STARTER' | 'STANDARD' | 'PRO', number> = {
  MICRO: CREDIT_PACKS.MICRO.credits,
  STARTER: CREDIT_PACKS.STARTER.credits,
  STANDARD: CREDIT_PACKS.STANDARD.credits,
  PRO: CREDIT_PACKS.PRO.credits,
};
type CreditPackId = keyof typeof PACK_CREDITS;

function isCreditPackId(value: unknown): value is CreditPackId {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(PACK_CREDITS, value)
  );
}

const CHECKOUT_SETTLEMENT_POLL_INTERVAL_MS = 2_000;
const CHECKOUT_SETTLEMENT_MAX_WAIT_MS = 5 * 60_000;
const CHECKOUT_CLOSE_RECONCILE_MAX_WAIT_MS = 45_000;
const CHECKOUT_SYNC_RETRY_COUNT = Math.max(
  API_TIMEOUTS.CREDIT_REFRESH_MAX_RETRIES,
  30
);
const CHECKOUT_BACKGROUND_SYNC_RETRY_COUNT = Math.max(
  CHECKOUT_SYNC_RETRY_COUNT * 2,
  90
);

type StripeSettlementStatus =
  | 'confirmed'
  | 'settled_pending_sync'
  | 'pending'
  | 'cancelled';

interface StripeSettlementResult {
  status: StripeSettlementStatus;
}

const checkoutVisibilityFollowUps = new Set<string>();
const checkoutSettlementFollowUps = new Set<string>();
function buildCheckoutFollowUpKey(
  mode: CheckoutMode,
  sessionId: string
): string {
  return `${mode}:${sessionId}`;
}

function emitCheckoutCancelled(
  mode: CheckoutMode,
  targetWindow?: BrowserWindow | null
): void {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (mode === 'byo') {
    targetWindow.webContents.send('byo-unlock-cancelled');
    return;
  }

  targetWindow.webContents.send('checkout-cancelled');
}

function shouldCloseCheckoutWindow(result: StripeSettlementResult): boolean {
  return result.status !== 'pending';
}

function isCheckoutCancelled(result: StripeSettlementResult): boolean {
  return result.status === 'cancelled';
}

interface CheckoutFollowUpOptions {
  mode: CheckoutMode;
  window?: BrowserWindow | null;
  baselineCredits?: number;
  expectedCredits?: number;
  packId?: CreditPackId;
}

function getCheckoutLocaleHint(): string {
  const raw = settingsStore.get('app_language_preference', 'en');
  if (typeof raw !== 'string') return 'en';
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : 'en';
}

export async function handleGetCreditBalance(): Promise<CreditBalanceResult> {
  // Dev override to simulate credit state without hitting the API
  const overrideRaw = process.env.CREDIT_BALANCE_OVERRIDE;
  const forceZero = process.env.FORCE_ZERO_CREDITS === '1';
  const perHourOverrideRaw = process.env.CREDITS_PER_HOUR_OVERRIDE;
  if (forceZero || (overrideRaw && overrideRaw.length > 0)) {
    const credits = forceZero ? 0 : Math.max(0, Number(overrideRaw) || 0);
    const creditsPerHour = Math.max(
      1,
      Number(perHourOverrideRaw) || CREDITS_PER_AUDIO_HOUR
    );
    store.set('balanceCredits', credits);
    store.set('creditsPerHour', creditsPerHour);
    return {
      success: true,
      creditBalance: credits,
      balanceHours: credits / creditsPerHour,
      creditsPerHour,
      updatedAt: new Date().toISOString(),
    };
  }

  try {
    // Get credit balance from the API (server returns creditBalance and updatedAt)
    const response = await withStage5AuthRetry(authHeaders =>
      axios.get(`${STAGE5_API_URL}/credits/${getDeviceId()}`, {
        headers: authHeaders,
      })
    );
    // Intentionally avoid logging successful GET /credits to reduce noise in the UI log modal

    const credits = Number(response.data?.creditBalance ?? 0);
    const perHour = Math.max(
      1,
      Number(process.env.CREDITS_PER_HOUR_OVERRIDE) ||
        Number(response.data?.creditsPerHour) ||
        CREDITS_PER_AUDIO_HOUR
    );
    const hours = credits / perHour;
    store.set('balanceCredits', credits);
    store.set('creditsPerHour', perHour); // Cache the conversion rate
    return {
      success: true,
      creditBalance: credits,
      balanceHours: hours,
      creditsPerHour: perHour,
      updatedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    throwIfStage5UpdateRequiredError({ error: err, source: 'stage5-api' });
    if (err.response) {
      sendNetLog(
        'error',
        `HTTP ${err.response.status} GET ${STAGE5_API_URL}/credits`,
        {
          status: err.response.status,
          url: err.config?.url,
          method: err.config?.method,
        }
      );
    } else if (err.request) {
      sendNetLog('error', `HTTP NO_RESPONSE GET ${STAGE5_API_URL}/credits`, {
        url: err.config?.url,
        method: err.config?.method,
      });
    }
    log.error('[credit-handler] handleGetCreditBalance error:', err);
    const cachedBal = store.get('balanceCredits', 0);
    const cachedPerHour = store.get('creditsPerHour', CREDITS_PER_AUDIO_HOUR);
    return {
      success: false,
      error: err.message,
      creditBalance: cachedBal,
      balanceHours: cachedBal / cachedPerHour,
      creditsPerHour: cachedPerHour,
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function handleCreateCheckoutSession(
  _evt: Electron.IpcMainInvokeEvent,
  packId: CreditPackId
): Promise<string | null> {
  try {
    let baselineCredits = store.get('balanceCredits', 0);
    try {
      const balanceSnapshot = await handleGetCreditBalance();
      if (typeof balanceSnapshot.creditBalance === 'number') {
        baselineCredits = balanceSnapshot.creditBalance;
      }
    } catch (balanceErr) {
      log.warn(
        '[credit-handler] Failed to refresh baseline credits before checkout:',
        balanceErr
      );
    }

    const expectedCredits = baselineCredits + PACK_CREDITS[packId];
    const apiUrl = `${STAGE5_API_URL}/payments/create-session`;
    log.info(
      `[credit-handler] Creating checkout session for ${packId} via ${apiUrl}`
    );
    const response = await withStage5AuthRetry(authHeaders =>
      axios.post(
        apiUrl,
        {
          packId,
          deviceId: getDeviceId(),
          locale: getCheckoutLocaleHint(),
        },
        {
          headers: authHeaders,
        }
      )
    );
    sendNetLog('info', `POST /payments/create-session -> ${response.status}`, {
      url: apiUrl,
      method: 'POST',
      status: response.status,
    });

    // Expecting backend to respond with { url: 'https://checkout.stripe.com/…' }
    if (response.data?.url) {
      log.info(
        `[credit-handler] Checkout session URL received: ${response.data.url}`
      );

      // Emit checkout-pending event so UI can show "syncing balance..." until webhook lands
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send('checkout-pending');
      }

      const checkoutSessionId =
        typeof response.data?.sessionId === 'string'
          ? response.data.sessionId
          : null;
      let settlementCheckInFlight = false;

      // Always open inside an Electron modal so we catch the redirect even in dev
      await openStripeCheckout({
        sessionUrl: response.data.url,
        defaultMode: 'credits',
        onSuccess: async ({ sessionId, mode }) => {
          settlementCheckInFlight = true;
          try {
            const result = await handleStripeSuccess(sessionId, {
              mode,
              window: mainWindow ?? null,
              baselineCredits,
              expectedCredits,
              packId,
            });

            if (isCheckoutCancelled(result)) {
              emitCheckoutCancelled(mode, mainWindow ?? null);
            }

            return shouldCloseCheckoutWindow(result);
          } finally {
            settlementCheckInFlight = false;
          }
        },
        onCancel: () => {
          emitCheckoutCancelled('credits', mainWindow ?? null);
        },
        onClosed: () => {
          if (settlementCheckInFlight) {
            log.info(
              '[credit-handler] Checkout window closed while settlement check is in flight; awaiting final confirmation state.'
            );
            return;
          }

          if (!checkoutSessionId) {
            emitCheckoutCancelled('credits', mainWindow ?? null);
            return;
          }

          settlementCheckInFlight = true;
          void (async () => {
            try {
              log.info(
                `[credit-handler] Checkout window closed before success redirect. Running background settlement reconciliation for session ${checkoutSessionId}.`
              );
              const result = await handleStripeSuccess(checkoutSessionId, {
                mode: 'credits',
                window: mainWindow ?? null,
                baselineCredits,
                expectedCredits,
                settlementMaxWaitMs: CHECKOUT_CLOSE_RECONCILE_MAX_WAIT_MS,
                packId,
              });
              if (result.status === 'confirmed') {
                log.info(
                  `[credit-handler] Checkout ${checkoutSessionId} reconciled as paid after manual close.`
                );
              } else if (result.status === 'settled_pending_sync') {
                log.info(
                  `[credit-handler] Checkout ${checkoutSessionId} settled after manual close; local credit visibility is still syncing.`
                );
              } else if (result.status === 'cancelled') {
                emitCheckoutCancelled('credits', mainWindow ?? null);
                log.info(
                  `[credit-handler] Checkout ${checkoutSessionId} was not paid during post-close reconciliation.`
                );
              } else {
                emitCheckoutCancelled('credits', mainWindow ?? null);
                scheduleCheckoutSettlementFollowUp(checkoutSessionId, {
                  mode: 'credits',
                  window: mainWindow ?? null,
                  baselineCredits,
                  expectedCredits,
                  packId,
                });
                log.info(
                  `[credit-handler] Checkout ${checkoutSessionId} is still unresolved after post-close reconciliation window. Clearing pending UI state and continuing reconciliation in the background.`
                );
              }
            } catch (error) {
              if (isStage5UpdateRequiredError(error)) {
                return;
              }
              log.error(
                '[credit-handler] Error during background checkout reconciliation after window close:',
                error
              );
            } finally {
              settlementCheckInFlight = false;
            }
          })();
        },
      });
      return null;
    }
    log.warn(
      '[credit-handler] Backend did not return a URL for checkout session.',
      response.data
    );
    return null;
  } catch (err: any) {
    throwIfStage5UpdateRequiredError({ error: err, source: 'stage5-api' });
    if (err.response) {
      sendNetLog(
        'error',
        `HTTP ${err.response.status} POST ${STAGE5_API_URL}/payments/create-session`,
        {
          status: err.response.status,
          url: err.config?.url,
          method: err.config?.method,
        }
      );
    } else if (err.request) {
      sendNetLog(
        'error',
        `HTTP NO_RESPONSE POST ${STAGE5_API_URL}/payments/create-session`,
        { url: err.config?.url, method: err.config?.method }
      );
    }
    log.error('[credit-handler] handleCreateCheckoutSession error:', err);
    return null;
  }
}

export async function handleCreateByoUnlockSession(): Promise<void> {
  const mainWindow = getMainWindow();
  const deviceId = getDeviceId();
  const apiUrl = `${STAGE5_API_URL}/payments/create-byo-unlock`;

  try {
    log.info('[credit-handler] Initiating BYO OpenAI unlock checkout.');

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('byo-unlock-pending');
    }

    const response = await withStage5AuthRetry(authHeaders =>
      axios.post(
        apiUrl,
        {
          deviceId,
          locale: getCheckoutLocaleHint(),
        },
        {
          headers: authHeaders,
        }
      )
    );
    sendNetLog(
      'info',
      `POST /payments/create-byo-unlock -> ${response.status}`,
      {
        url: apiUrl,
        method: 'POST',
        status: response.status,
      }
    );

    const checkoutUrl = response.data?.url;
    if (!checkoutUrl) {
      log.warn(
        '[credit-handler] BYO unlock endpoint did not return a checkout URL.'
      );
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('byo-unlock-cancelled');
      }
      return;
    }

    const checkoutSessionId =
      typeof response.data?.sessionId === 'string'
        ? response.data.sessionId
        : null;
    let settlementCheckInFlight = false;

    await openStripeCheckout({
      sessionUrl: checkoutUrl,
      defaultMode: 'byo',
      onSuccess: async ({ sessionId, mode }) => {
        settlementCheckInFlight = true;
        try {
          const result = await handleStripeSuccess(sessionId, {
            mode,
            window: mainWindow,
          });

          if (isCheckoutCancelled(result)) {
            emitCheckoutCancelled(mode, mainWindow);
          }

          return shouldCloseCheckoutWindow(result);
        } finally {
          settlementCheckInFlight = false;
        }
      },
      onCancel: () => {
        emitCheckoutCancelled('byo', mainWindow);
      },
      onClosed: () => {
        if (settlementCheckInFlight) {
          log.info(
            '[credit-handler] BYO checkout window closed while settlement check is in flight; awaiting final confirmation state.'
          );
          return;
        }

        if (!checkoutSessionId) {
          emitCheckoutCancelled('byo', mainWindow);
          return;
        }

        settlementCheckInFlight = true;
        void (async () => {
          try {
            log.info(
              `[credit-handler] BYO checkout window closed before success redirect. Running background settlement reconciliation for session ${checkoutSessionId}.`
            );
            const result = await handleStripeSuccess(checkoutSessionId, {
              mode: 'byo',
              window: mainWindow,
              settlementMaxWaitMs: CHECKOUT_CLOSE_RECONCILE_MAX_WAIT_MS,
            });
            if (result.status === 'confirmed') {
              log.info(
                `[credit-handler] BYO checkout ${checkoutSessionId} reconciled as paid after manual close.`
              );
            } else if (result.status === 'settled_pending_sync') {
              log.info(
                `[credit-handler] BYO checkout ${checkoutSessionId} settled after manual close; entitlement visibility is still syncing.`
              );
            } else if (result.status === 'cancelled') {
              emitCheckoutCancelled('byo', mainWindow);
              log.info(
                `[credit-handler] BYO checkout ${checkoutSessionId} was not paid during post-close reconciliation.`
              );
            } else {
              emitCheckoutCancelled('byo', mainWindow);
              scheduleCheckoutSettlementFollowUp(checkoutSessionId, {
                mode: 'byo',
                window: mainWindow,
              });
              log.info(
                `[credit-handler] BYO checkout ${checkoutSessionId} is still unresolved after post-close reconciliation window. Clearing pending UI state and continuing reconciliation in the background.`
              );
            }
          } catch (error) {
            if (isStage5UpdateRequiredError(error)) {
              return;
            }
            log.error(
              '[credit-handler] Error during background BYO checkout reconciliation after window close:',
              error
            );
          } finally {
            settlementCheckInFlight = false;
          }
        })();
      },
    });
  } catch (err: any) {
    throwIfStage5UpdateRequiredError({ error: err, source: 'stage5-api' });
    if (err?.response) {
      sendNetLog('error', `HTTP ${err.response.status} POST ${apiUrl}`, {
        status: err.response.status,
        url: err.config?.url,
        method: err.config?.method,
        data: err.response?.data,
      });
    } else if (err?.request) {
      sendNetLog('error', `HTTP NO_RESPONSE POST ${apiUrl}`, {
        url: err.config?.url,
        method: err.config?.method,
      });
    }

    log.error('[credit-handler] Failed to initiate BYO unlock checkout:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('byo-unlock-error', {
        message:
          err?.response?.data?.message ||
          err?.message ||
          'Unable to start checkout',
      });
    }
  }
}

type CheckoutMode = 'credits' | 'byo';

interface StripeCheckoutOptions {
  sessionUrl: string;
  defaultMode: CheckoutMode;
  onSuccess?: (payload: {
    sessionId?: string | null;
    mode: CheckoutMode;
    url: string;
  }) => boolean | void | Promise<boolean | void>;
  onCancel?: () => void;
  onClosed?: () => void;
}

// Function to open Stripe checkout in a BrowserWindow
async function openStripeCheckout(
  options: StripeCheckoutOptions
): Promise<void> {
  return new Promise(resolve => {
    const parent = getMainWindow() ?? undefined;
    const win = new BrowserWindow({
      width: 800,
      height: 1000,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
      parent,
      modal: true,
    });

    win.loadURL(options.sessionUrl);

    let completed = false;
    let skipOnClosedCallback = false;
    let successRedirectPayload: {
      sessionId?: string | null;
      mode: CheckoutMode;
      url: string;
    } | null = null;

    const cleanup = () => {
      try {
        if (!win.isDestroyed()) {
          win.webContents.removeListener('will-redirect', handleRedirect);
          win.webContents.removeListener('will-navigate', handleRedirect);
          win.webContents.removeListener('did-fail-load', handleLoadFailure);
        }
      } catch (e) {
        log.warn(
          '[credit-handler] Cleanup after checkout encountered an issue:',
          e
        );
      }
    };

    const finish = async ({
      cb,
    }: {
      cb?: () => void | Promise<void>;
    } = {}) => {
      if (completed) return;
      completed = true;
      cleanup();
      try {
        await cb?.();
      } catch (err) {
        log.error('[credit-handler] Error during checkout callback:', err);
      }
      resolve();
    };

    const parseMode = (raw: string | null): CheckoutMode => {
      return raw === 'byo' ? 'byo' : 'credits';
    };
    let successRedirectHandled = false;
    let cancelRedirectHandled = false;
    let loadFailureHandled = false;

    const handleSuccess = async (payload: {
      sessionId?: string | null;
      mode: CheckoutMode;
      url: string;
    }) => {
      let shouldClose = true;
      try {
        if (options.onSuccess) {
          const result = await options.onSuccess(payload);
          if (result === false) {
            shouldClose = false;
          }
        }
      } catch (err) {
        log.error('[credit-handler] onSuccess handler threw:', err);
        shouldClose = isStage5UpdateRequiredError(err);
      }

      if (!shouldClose) {
        log.info(
          '[credit-handler] Keeping checkout window open while payment is still settling.'
        );
        return;
      }

      log.info('[credit-handler] Success handled after manual close.');
    };

    const handleRedirect = (_event: Electron.Event, url: string) => {
      try {
        const targetUrl = new URL(url);
        const pathname = targetUrl.pathname;

        if (pathname.startsWith('/checkout/success')) {
          if (successRedirectHandled) {
            log.info(
              '[credit-handler] Ignoring duplicate checkout success redirect event.'
            );
            return;
          }
          successRedirectHandled = true;
          const mode = parseMode(
            targetUrl.searchParams.get('mode') ?? options.defaultMode
          );
          const sessionId = targetUrl.searchParams.get('session_id');
          successRedirectPayload = { sessionId, mode, url };
          log.info(
            '[credit-handler] Checkout success redirect observed. Waiting for manual close before reconciling payment.'
          );
          return;
        }

        if (pathname.startsWith('/checkout/cancelled')) {
          if (successRedirectHandled) {
            log.info(
              '[credit-handler] Ignoring checkout cancelled redirect after success redirect was already observed.'
            );
            return;
          }
          if (cancelRedirectHandled) {
            log.info(
              '[credit-handler] Ignoring duplicate checkout cancelled redirect event.'
            );
            return;
          }
          cancelRedirectHandled = true;
          try {
            options.onCancel?.();
          } catch (err) {
            log.error(
              '[credit-handler] Error during checkout cancel callback:',
              err
            );
          }
          if (!win.isDestroyed()) {
            try {
              win.close();
            } catch (err) {
              log.warn(
                '[credit-handler] Failed to close checkout window after cancel redirect:',
                err
              );
            }
          }
          log.info(
            '[credit-handler] Checkout cancelled redirect observed. Closing checkout window.'
          );
          return;
        }
      } catch (err) {
        log.error(
          '[credit-handler] Failed to parse checkout redirect URL:',
          err
        );
      }
    };

    const handleLoadFailure = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedURL?: string
    ) => {
      if (errorCode === -3) {
        log.info(
          `[credit-handler] Ignoring non-fatal checkout navigation abort for ${validatedURL || 'unknown URL'}.`
        );
        return;
      }

      log.error(
        `[credit-handler] Checkout window failed to load: ${errorCode} - ${errorDescription}`
      );
      if (successRedirectHandled || loadFailureHandled) {
        return;
      }

      loadFailureHandled = true;
      try {
        options.onCancel?.();
      } catch (err) {
        log.error(
          '[credit-handler] Error during checkout load-failure callback:',
          err
        );
      }
      skipOnClosedCallback = true;
      if (!win.isDestroyed()) {
        try {
          win.close();
        } catch (err) {
          log.warn(
            '[credit-handler] Failed to close checkout window after load failure:',
            err
          );
        }
      }
      log.info(
        '[credit-handler] Checkout load failure surfaced to the app. Closing the window so the user can retry.'
      );
    };

    win.webContents.on('will-redirect', handleRedirect);
    win.webContents.on('will-navigate', handleRedirect); // Extra safety net for Windows/Linux
    win.webContents.on('did-fail-load', handleLoadFailure);

    win.on('closed', () => {
      if (successRedirectPayload) {
        void finish({
          cb: () => handleSuccess(successRedirectPayload!),
        });
        return;
      }
      if (skipOnClosedCallback || cancelRedirectHandled) {
        void finish();
        return;
      }
      void finish({ cb: options.onClosed });
    });
  });
}

export async function handleResetCredits(): Promise<{
  success: boolean;
  creditsAdded?: number;
  error?: string;
}> {
  try {
    log.info('[credit-handler] Attempting admin add credits...');
    const adminSecret = getConfiguredAdminSecret();
    if (!adminSecret) {
      return { success: false, error: 'Admin secret not configured' };
    }

    const response = await axios.post(
      `${STAGE5_API_URL}/admin/add-credits`,
      {
        deviceId: getDeviceId(),
        pack: 'STANDARD',
      },
      {
        headers: {
          'X-Admin-Secret': adminSecret,
          ...getStage5VersionHeaders(),
        },
      }
    );

    if (response.data?.success) {
      const { creditsAdded } = response.data;
      log.info(
        `[credit-handler] ✅ Admin add credits successful: Added ${creditsAdded} credits`
      );

      // Force a refresh so UI updates instantly
      const updatedBalance = await handleGetCreditBalance();

      // Broadcast the updated balance to renderer
      if (
        updatedBalance.success &&
        updatedBalance.creditBalance !== undefined
      ) {
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send('credits-updated', {
            creditBalance: updatedBalance.creditBalance,
            hoursBalance: updatedBalance.balanceHours || 0,
          });
        }
      }

      return {
        success: true,
        creditsAdded,
      };
    } else {
      const error = response.data?.error || 'Unknown error';
      log.error(`[credit-handler] ❌ Admin add credits failed: ${error}`);
      return { success: false, error };
    }
  } catch (err: any) {
    throwIfStage5UpdateRequiredError({ error: err, source: 'stage5-api' });
    log.error('[credit-handler] ❌ Admin add credits error:', err);
    return {
      success: false,
      error: err.response?.data?.error || err.message || 'Network error',
    };
  }
}

export async function handleResetCreditsToZero(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    log.info('[credit-handler] Attempting admin credit reset to zero...');
    const adminSecret = getConfiguredAdminSecret();
    if (!adminSecret) {
      return { success: false, error: 'Admin secret not configured' };
    }

    const response = await axios.post(
      `${STAGE5_API_URL}/admin/reset-to-zero`,
      {
        deviceId: getDeviceId(),
      },
      {
        headers: {
          'X-Admin-Secret': adminSecret,
          ...getStage5VersionHeaders(),
        },
      }
    );

    if (response.data?.success) {
      log.info('[credit-handler] ✅ Admin reset to zero successful');

      // Force a refresh so UI updates instantly
      const updatedBalance = await handleGetCreditBalance();

      // Broadcast the updated balance to renderer
      if (
        updatedBalance.success &&
        updatedBalance.creditBalance !== undefined
      ) {
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send('credits-updated', {
            creditBalance: updatedBalance.creditBalance,
            hoursBalance: updatedBalance.balanceHours || 0,
          });
        }
      }

      return { success: true };
    } else {
      const error = response.data?.error || 'Unknown error';
      log.error(`[credit-handler] ❌ Admin reset to zero failed: ${error}`);
      return { success: false, error };
    }
  } catch (err: any) {
    throwIfStage5UpdateRequiredError({ error: err, source: 'stage5-api' });
    log.error('[credit-handler] ❌ Admin reset to zero error:', err);
    return {
      success: false,
      error: err.response?.data?.error || err.message || 'Network error',
    };
  }
}

interface CheckoutSessionState {
  status: string | null;
  paymentStatus: string | null;
  packId?: string | null;
  entitlement?: string | null;
  created?: number | null;
}

interface CheckoutSessionPollResult {
  state: CheckoutSessionState | null;
  nonRetryableStatus?: number;
}

async function getCheckoutSessionState(
  sessionId: string
): Promise<CheckoutSessionPollResult> {
  const url = `${STAGE5_API_URL}/payments/session/${encodeURIComponent(sessionId)}`;
  const response = await withStage5AuthRetryOnResponse(authHeaders =>
    axios.get(url, {
      headers: authHeaders,
      validateStatus: () => true,
    })
  );

  throwIfStage5UpdateRequiredResponse({
    response,
    source: 'stage5-api',
  });

  if (response.status === 200) {
    return {
      state: {
        status: (response.data?.status as string | null) ?? null,
        paymentStatus: (response.data?.paymentStatus as string | null) ?? null,
        packId: (response.data?.packId as string | null) ?? null,
        entitlement: (response.data?.entitlement as string | null) ?? null,
        created:
          typeof response.data?.created === 'number'
            ? response.data.created
            : null,
      },
    };
  }

  if ([400, 401, 403, 404].includes(response.status)) {
    return { state: null, nonRetryableStatus: response.status };
  }

  return { state: null };
}

async function waitForCheckoutSettlement(
  sessionId: string,
  maxWaitMs = CHECKOUT_SETTLEMENT_MAX_WAIT_MS
): Promise<{
  paid: boolean;
  timedOut: boolean;
  state: CheckoutSessionState | null;
}> {
  const startedAt = Date.now();
  let lastState: CheckoutSessionState | null = null;

  while (Date.now() - startedAt < maxWaitMs) {
    try {
      const pollResult = await getCheckoutSessionState(sessionId);
      if (typeof pollResult.nonRetryableStatus === 'number') {
        const err = new Error(
          `Non-retryable checkout session status error (${pollResult.nonRetryableStatus})`
        );
        err.name = 'NonRetryableCheckoutSessionStatusError';
        throw err;
      }

      const state = pollResult.state;
      if (state) {
        lastState = state;
        if (
          state.paymentStatus === 'paid' ||
          state.paymentStatus === 'no_payment_required'
        ) {
          return { paid: true, timedOut: false, state };
        }
        if (state.status === 'expired') {
          return { paid: false, timedOut: false, state };
        }
      }
    } catch (error: any) {
      if (isStage5UpdateRequiredError(error)) {
        throw error;
      }
      const status = error?.response?.status;
      const isNonRetryableStatus =
        status === 400 || status === 401 || status === 403 || status === 404;
      if (
        error instanceof Error &&
        (error.name === 'NonRetryableCheckoutSessionStatusError' ||
          isNonRetryableStatus)
      ) {
        throw error;
      }
      log.warn(
        `[credit-handler] Transient settlement polling error for ${sessionId}: ${error?.message || error}`
      );
    }

    await new Promise(resolve =>
      setTimeout(resolve, CHECKOUT_SETTLEMENT_POLL_INTERVAL_MS)
    );
  }

  return { paid: false, timedOut: true, state: lastState };
}

interface CreditLedgerEntry {
  delta?: unknown;
  reason?: unknown;
  meta?: unknown;
  created_at?: unknown;
}

function parseSqlTimestampUtcMs(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );
  if (!match) {
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
}

function parseLedgerMeta(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

async function hasCheckoutLedgerConfirmation({
  sessionId,
  packId,
  stripeSessionCreatedUnix,
}: {
  sessionId: string;
  packId: CreditPackId;
  stripeSessionCreatedUnix?: number | null;
}): Promise<boolean> {
  const deviceId = getDeviceId();
  const expectedReason = `PACK_${packId}`;
  const expectedDelta = PACK_CREDITS[packId];
  const response = await withStage5AuthRetryOnResponse(authHeaders =>
    axios.get(`${STAGE5_API_URL}/credits/${deviceId}/ledger`, {
      headers: authHeaders,
      validateStatus: () => true,
    })
  );

  throwIfStage5UpdateRequiredResponse({
    response,
    source: 'stage5-api',
  });

  if (response.status !== 200 || !Array.isArray(response.data)) {
    const isNonRetryable =
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404;
    if (isNonRetryable) {
      log.warn(
        `[credit-handler] Ledger confirmation unavailable (status=${response.status}) for checkout ${sessionId}.`
      );
    }
    return false;
  }

  const sessionCreatedMs =
    typeof stripeSessionCreatedUnix === 'number' &&
    Number.isFinite(stripeSessionCreatedUnix)
      ? stripeSessionCreatedUnix * 1000
      : null;

  for (const rawEntry of response.data as CreditLedgerEntry[]) {
    const reason =
      typeof rawEntry?.reason === 'string' ? rawEntry.reason.trim() : '';
    if (reason !== expectedReason) {
      continue;
    }

    const delta = Number(rawEntry?.delta);
    if (!Number.isFinite(delta) || delta < expectedDelta) {
      continue;
    }

    const meta = parseLedgerMeta(rawEntry?.meta);
    const metaSessionId =
      meta && typeof meta.checkoutSessionId === 'string'
        ? meta.checkoutSessionId
        : null;
    if (metaSessionId) {
      if (metaSessionId === sessionId) {
        return true;
      }
      continue;
    }

    if (typeof sessionCreatedMs === 'number') {
      const createdAtMs = parseSqlTimestampUtcMs(rawEntry?.created_at);
      if (
        typeof createdAtMs === 'number' &&
        createdAtMs + 1000 >= sessionCreatedMs &&
        createdAtMs <= Date.now() + 60_000
      ) {
        return true;
      }
    }
  }

  return false;
}

async function refreshCreditsAfterPayment({
  sessionId,
  baselineCredits,
  expectedCredits,
  packId,
  stripeSessionCreatedUnix,
  targetWindow,
  maxRetries = CHECKOUT_SYNC_RETRY_COUNT,
}: {
  sessionId: string;
  baselineCredits?: number;
  expectedCredits?: number;
  packId?: CreditPackId;
  stripeSessionCreatedUnix?: number | null;
  targetWindow?: BrowserWindow | null;
  maxRetries?: number;
}): Promise<boolean> {
  const deviceId = getDeviceId();

  const publishCreditsSnapshot = ({
    credits,
    perHour,
    confirmed,
  }: {
    credits: number;
    perHour: number;
    confirmed: boolean;
  }) => {
    const hours = credits / perHour;
    store.set('balanceCredits', credits);
    store.set('creditsPerHour', perHour);

    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('credits-updated', {
        creditBalance: credits,
        hoursBalance: hours,
      });
      if (confirmed) {
        targetWindow.webContents.send('checkout-confirmed');
      }
    }
  };

  const retryDelay = API_TIMEOUTS.CREDIT_REFRESH_RETRY_DELAY;
  const ledgerCheckInterval = 3;
  let lastObservedCredits: number | null = null;
  let lastObservedPerHour: number | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await withStage5AuthRetry(authHeaders =>
        axios.get(`${STAGE5_API_URL}/credits/${deviceId}`, {
          headers: authHeaders,
        })
      );

      throwIfStage5UpdateRequiredResponse({
        response,
        source: 'stage5-api',
      });

      if (typeof response.data?.creditBalance !== 'number') {
        await new Promise(r => setTimeout(r, retryDelay));
        continue;
      }

      const credits = Number(response.data.creditBalance) || 0;
      const perHour = Math.max(
        1,
        Number(process.env.CREDITS_PER_HOUR_OVERRIDE) ||
          Number(response.data?.creditsPerHour) ||
          CREDITS_PER_AUDIO_HOUR
      );
      lastObservedCredits = credits;
      lastObservedPerHour = perHour;

      const meetsExpectedCredits =
        typeof expectedCredits === 'number'
          ? credits >= expectedCredits
          : false;
      const exceedsBaselineCredits =
        typeof baselineCredits === 'number' ? credits > baselineCredits : false;
      const noBaselineExpectation =
        typeof expectedCredits !== 'number' &&
        typeof baselineCredits !== 'number';
      const requiresLedgerConfirmation =
        noBaselineExpectation && Boolean(packId);
      const hasConfirmedCreditRefresh =
        meetsExpectedCredits ||
        exceedsBaselineCredits ||
        (noBaselineExpectation && !requiresLedgerConfirmation);

      if (hasConfirmedCreditRefresh) {
        publishCreditsSnapshot({ credits, perHour, confirmed: true });
        return true;
      }

      const shouldCheckLedger =
        Boolean(packId) &&
        (i === 0 ||
          i === maxRetries - 1 ||
          (i + 1) % ledgerCheckInterval === 0);
      if (shouldCheckLedger && packId) {
        try {
          const hasLedgerConfirmation = await hasCheckoutLedgerConfirmation({
            sessionId,
            packId,
            stripeSessionCreatedUnix,
          });
          if (hasLedgerConfirmation) {
            log.info(
              `[credit-handler] Confirmed top-up via ledger reconciliation for checkout ${sessionId} despite balance delta being obscured (credits=${credits}, expected>=${expectedCredits ?? 'n/a'}, baseline=${baselineCredits ?? 'n/a'}).`
            );
            publishCreditsSnapshot({ credits, perHour, confirmed: true });
            return true;
          }
        } catch (ledgerErr: any) {
          if (isStage5UpdateRequiredError(ledgerErr)) {
            throw ledgerErr;
          }
          log.warn(
            `[credit-handler] Failed ledger confirmation check for ${sessionId}: ${ledgerErr?.message || ledgerErr}`
          );
        }
      }

      if (!hasConfirmedCreditRefresh) {
        log.info(
          `[credit-handler] Waiting for top-up to land (attempt ${i + 1}/${maxRetries}, credits=${credits}, expected>=${expectedCredits ?? 'n/a'}, baseline=${baselineCredits ?? 'n/a'})`
        );
        await new Promise(r => setTimeout(r, retryDelay));
        continue;
      }
    } catch (retryErr: any) {
      throwIfStage5UpdateRequiredError({
        error: retryErr,
        source: 'stage5-api',
      });
      if (isStage5UpdateRequiredError(retryErr)) {
        throw retryErr;
      }
      const status = retryErr?.response?.status;
      if (status === 401 || status === 403 || status === 404) {
        throw retryErr;
      }
      if (i === maxRetries - 1) {
        throw retryErr;
      }
      await new Promise(r => setTimeout(r, retryDelay));
    }
  }

  if (
    typeof lastObservedCredits === 'number' &&
    typeof lastObservedPerHour === 'number'
  ) {
    log.warn(
      `[credit-handler] Paid checkout settlement confirmed but no credit refresh signal was observed after ${maxRetries} attempts (credits=${lastObservedCredits}, expected>=${expectedCredits ?? 'n/a'}, baseline=${baselineCredits ?? 'n/a'}, pack=${packId ?? 'n/a'}).`
    );
    publishCreditsSnapshot({
      credits: lastObservedCredits,
      perHour: lastObservedPerHour,
      confirmed: false,
    });
  }

  return false;
}

async function waitForCheckoutEntitlementSync({
  sessionId,
  expectedEntitlement,
  targetWindow,
  maxRetries = CHECKOUT_SYNC_RETRY_COUNT,
}: {
  sessionId: string;
  expectedEntitlement: CheckoutEntitlement;
  targetWindow?: BrowserWindow | null;
  maxRetries?: number;
}): Promise<boolean> {
  const retryDelay = API_TIMEOUTS.CREDIT_REFRESH_RETRY_DELAY;

  for (let i = 0; i < maxRetries; i++) {
    const snapshot = await syncEntitlements({
      window: targetWindow ?? undefined,
    });
    if (hasUnlockedCheckoutEntitlement(snapshot, expectedEntitlement)) {
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('byo-unlock-confirmed', snapshot);
      }
      log.info(
        `[credit-handler] Entitlements synced for ${expectedEntitlement}. openai=${snapshot.byoOpenAi} anthropic=${snapshot.byoAnthropic} elevenlabs=${snapshot.byoElevenLabs}`
      );
      return true;
    }

    await new Promise(r => setTimeout(r, retryDelay));
  }

  log.warn(
    `[credit-handler] BYO payment settled but expected entitlement ${expectedEntitlement} is not visible yet (session=${sessionId}).`
  );
  return false;
}

function scheduleCheckoutVisibilityFollowUp(
  sessionId: string,
  opts: CheckoutFollowUpOptions & {
    stripeSessionCreatedUnix?: number | null;
    expectedEntitlement?: CheckoutEntitlement;
  }
): void {
  const key = buildCheckoutFollowUpKey(opts.mode, sessionId);
  if (checkoutVisibilityFollowUps.has(key)) {
    return;
  }

  checkoutVisibilityFollowUps.add(key);
  void (async () => {
    try {
      if (opts.mode === 'byo') {
        const synced = await waitForCheckoutEntitlementSync({
          sessionId,
          expectedEntitlement: opts.expectedEntitlement ?? 'byo_openai',
          targetWindow: opts.window,
          maxRetries: CHECKOUT_BACKGROUND_SYNC_RETRY_COUNT,
        });
        if (!synced) {
          log.warn(
            `[credit-handler] Background BYO entitlement reconciliation exhausted without confirmation for ${sessionId}.`
          );
        }
        return;
      }

      const synced = await refreshCreditsAfterPayment({
        sessionId,
        baselineCredits: opts.baselineCredits,
        expectedCredits: opts.expectedCredits,
        packId: opts.packId,
        stripeSessionCreatedUnix: opts.stripeSessionCreatedUnix,
        targetWindow: opts.window,
        maxRetries: CHECKOUT_BACKGROUND_SYNC_RETRY_COUNT,
      });
      if (!synced) {
        log.warn(
          `[credit-handler] Background checkout credit reconciliation exhausted without visibility for ${sessionId}.`
        );
      }
    } catch (error: any) {
      if (isStage5UpdateRequiredError(error)) {
        return;
      }
      log.error(
        `[credit-handler] Background ${opts.mode} settlement reconciliation failed for ${sessionId}:`,
        error
      );
      if (opts.mode === 'byo' && opts.window && !opts.window.isDestroyed()) {
        opts.window.webContents.send('byo-unlock-error', {
          message: error?.message || 'Failed to refresh entitlements',
        });
      }
    } finally {
      checkoutVisibilityFollowUps.delete(key);
    }
  })();
}

function scheduleCheckoutSettlementFollowUp(
  sessionId: string,
  opts: CheckoutFollowUpOptions
): void {
  const key = buildCheckoutFollowUpKey(opts.mode, sessionId);
  if (checkoutSettlementFollowUps.has(key)) {
    return;
  }

  checkoutSettlementFollowUps.add(key);
  void (async () => {
    try {
      const result = await handleStripeSuccess(sessionId, {
        mode: opts.mode,
        window: opts.window,
        baselineCredits: opts.baselineCredits,
        expectedCredits: opts.expectedCredits,
        packId: opts.packId,
      });

      if (result.status === 'confirmed') {
        log.info(
          `[credit-handler] Background ${opts.mode} settlement reconciliation confirmed ${sessionId}.`
        );
      } else if (result.status === 'settled_pending_sync') {
        log.info(
          `[credit-handler] Background ${opts.mode} settlement reconciliation settled ${sessionId}; visibility sync is still pending.`
        );
      } else if (result.status === 'cancelled') {
        emitCheckoutCancelled(opts.mode, opts.window ?? null);
        log.info(
          `[credit-handler] Background ${opts.mode} settlement reconciliation determined ${sessionId} was not paid.`
        );
      } else {
        log.warn(
          `[credit-handler] Background ${opts.mode} settlement reconciliation still timed out for ${sessionId}.`
        );
      }
    } catch (error: any) {
      if (isStage5UpdateRequiredError(error)) {
        return;
      }
      log.error(
        `[credit-handler] Background ${opts.mode} settlement reconciliation failed for ${sessionId}:`,
        error
      );
    } finally {
      checkoutSettlementFollowUps.delete(key);
    }
  })();
}

export async function handleStripeSuccess(
  sessionId?: string | null,
  opts: {
    mode?: CheckoutMode;
    window?: BrowserWindow | null;
    baselineCredits?: number;
    expectedCredits?: number;
    packId?: CreditPackId;
    settlementMaxWaitMs?: number;
  } = {}
): Promise<StripeSettlementResult> {
  const mode = opts.mode ?? 'credits';
  const targetWindow = opts.window ?? getMainWindow();

  if (mode === 'byo') {
    if (!sessionId) {
      log.warn(
        '[credit-handler] Missing sessionId for BYO checkout settlement check.'
      );
      return { status: 'cancelled' };
    }

    try {
      const settlement = await waitForCheckoutSettlement(
        sessionId,
        opts.settlementMaxWaitMs
      );
      if (!settlement.paid) {
        if (settlement.timedOut) {
          log.warn(
            `[credit-handler] BYO checkout ${sessionId} still pending after timeout.`
          );
        } else {
          log.warn(
            `[credit-handler] BYO checkout ${sessionId} not paid (status=${settlement.state?.status ?? 'unknown'}, paymentStatus=${settlement.state?.paymentStatus ?? 'unknown'}).`
          );
        }
        return { status: settlement.timedOut ? 'pending' : 'cancelled' };
      }

      const expectedEntitlement =
        normalizeCheckoutEntitlement(settlement.state?.entitlement) ??
        'byo_openai';
      const entitlementsSynced = await waitForCheckoutEntitlementSync({
        sessionId,
        expectedEntitlement,
        targetWindow,
      });
      if (!entitlementsSynced) {
        scheduleCheckoutVisibilityFollowUp(sessionId, {
          mode,
          window: targetWindow,
          expectedEntitlement,
        });
        return { status: 'settled_pending_sync' };
      }
      return { status: 'confirmed' };
    } catch (error: any) {
      if (isStage5UpdateRequiredError(error)) {
        throw error;
      }
      log.error(
        '[credit-handler] Failed to sync entitlements after BYO unlock:',
        error
      );
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('byo-unlock-error', {
          message: error?.message || 'Failed to refresh entitlements',
        });
      }
      return { status: 'pending' };
    }
  }

  if (!sessionId) {
    log.warn('[credit-handler] Stripe success without sessionId for credits.');
    return { status: 'cancelled' };
  }

  try {
    log.info(`[credit-handler] Processing successful payment: ${sessionId}`);

    const settlement = await waitForCheckoutSettlement(
      sessionId,
      opts.settlementMaxWaitMs
    );
    if (!settlement.paid) {
      if (settlement.timedOut) {
        log.warn(
          `[credit-handler] Checkout ${sessionId} still pending after timeout.`
        );
      } else {
        log.warn(
          `[credit-handler] Checkout ${sessionId} not paid (status=${settlement.state?.status ?? 'unknown'}, paymentStatus=${settlement.state?.paymentStatus ?? 'unknown'}).`
        );
      }
      return { status: settlement.timedOut ? 'pending' : 'cancelled' };
    }

    const settlementPackId = isCreditPackId(settlement.state?.packId)
      ? settlement.state.packId
      : undefined;
    if (settlementPackId && opts.packId && settlementPackId !== opts.packId) {
      log.warn(
        `[credit-handler] Checkout pack mismatch for ${sessionId} (requested=${opts.packId}, settlement=${settlementPackId}). Using settlement pack for reconciliation.`
      );
    }

    const creditsSynced = await refreshCreditsAfterPayment({
      sessionId,
      baselineCredits: opts.baselineCredits,
      expectedCredits: opts.expectedCredits,
      packId: settlementPackId ?? opts.packId,
      stripeSessionCreatedUnix: settlement.state?.created,
      targetWindow,
    });
    if (!creditsSynced) {
      log.warn(
        `[credit-handler] Checkout paid but credits not visible yet (session=${sessionId}).`
      );
      scheduleCheckoutVisibilityFollowUp(sessionId, {
        mode,
        window: targetWindow,
        baselineCredits: opts.baselineCredits,
        expectedCredits: opts.expectedCredits,
        packId: settlementPackId ?? opts.packId,
        stripeSessionCreatedUnix: settlement.state?.created,
      });
      return { status: 'settled_pending_sync' };
    }
    return { status: 'confirmed' };
  } catch (error) {
    if (isStage5UpdateRequiredError(error)) {
      throw error;
    }
    log.error('[credit-handler] Error refreshing credit balance:', error);
    return { status: 'pending' };
  }
}

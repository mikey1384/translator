import Store from 'electron-store';
import { app, BrowserWindow, shell } from 'electron';
import axios from 'axios';
import log from 'electron-log';
import { v4 as uuidv4 } from 'uuid';
import {
  setByoUnlocked,
  syncEntitlements,
} from '../services/entitlements-manager.js';
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
import { resolveCheckoutCountryHintFromLocale } from '../utils/checkout-locale.js';
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

function serializePaymentEventLogMeta(value: unknown): any {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {
      unserializable: true,
      preview: String(value),
    };
  }
}

function tracePaymentEventReceipt(
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: unknown
): void {
  const safeMeta = serializePaymentEventLogMeta(meta);
  if (level === 'info') {
    log.info(message, safeMeta);
  } else if (level === 'warn') {
    log.warn(message, safeMeta);
  } else {
    log.error(message, safeMeta);
  }
  sendNetLog(level, message, safeMeta);
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

class PaymentEventStreamUnavailableError extends Error {
  constructor(message = 'Payment event stream is unavailable in this environment') {
    super(message);
    this.name = 'PaymentEventStreamUnavailableError';
  }
}

function isPaymentEventStreamUnavailableError(error: unknown): boolean {
  return error instanceof PaymentEventStreamUnavailableError;
}

function isCreditPackId(value: unknown): value is CreditPackId {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(PACK_CREDITS, value)
  );
}

const CHECKOUT_SETTLEMENT_POLL_INTERVAL_MS = 2_000;
const CHECKOUT_SETTLEMENT_POLL_REQUEST_TIMEOUT_MS = 10_000;
const CHECKOUT_SETTLEMENT_MAX_WAIT_MS = 5 * 60_000;
const CHECKOUT_EXTERNAL_FOREGROUND_SETTLEMENT_MAX_WAIT_MS = 30_000;
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

interface CreditSnapshotPayload {
  creditBalance: number;
  hoursBalance: number;
  creditsPerHour: number;
  authoritative: boolean;
  checkoutSessionId?: string | null;
}

type CheckoutMode = 'credits' | 'byo';

const checkoutVisibilityFollowUps = new Set<string>();
const checkoutSettlementFollowUps = new Set<string>();
const externalCheckoutSettlementFollowUps = new Set<string>();
const activeCheckoutSessions: Partial<Record<CheckoutMode, string>> = {};
function buildCheckoutFollowUpKey(
  mode: CheckoutMode,
  sessionId: string
): string {
  return `${mode}:${sessionId}`;
}

function shouldUseEmbeddedCheckoutWindow(): boolean {
  const raw = process.env.STAGE5_EMBEDDED_CHECKOUT;
  return raw === '1' || raw?.toLowerCase() === 'true';
}

function getCheckoutLogLabel(sessionId?: string | null): string {
  return sessionId ? `session ${sessionId}` : 'session id unavailable';
}

function getActiveCheckoutSessionId(mode: CheckoutMode): string | null {
  return activeCheckoutSessions[mode] ?? null;
}

function setActiveCheckoutSession(
  mode: CheckoutMode,
  sessionId: string | null | undefined
): void {
  if (!sessionId) {
    return;
  }

  const previousSessionId = getActiveCheckoutSessionId(mode);
  activeCheckoutSessions[mode] = sessionId;

  if (previousSessionId && previousSessionId !== sessionId) {
    log.info(
      `[credit-handler] Replaced active ${mode} checkout ${previousSessionId} with ${sessionId}.`
    );
    return;
  }

  if (previousSessionId !== sessionId) {
    log.info(
      `[credit-handler] Marked ${mode} checkout ${sessionId} as active.`
    );
  }
}

function clearActiveCheckoutSession(
  mode: CheckoutMode,
  sessionId?: string | null
): boolean {
  const activeSessionId = getActiveCheckoutSessionId(mode);
  if (!activeSessionId) {
    return sessionId == null;
  }

  if (!sessionId) {
    return false;
  }

  if (activeSessionId !== sessionId) {
    return false;
  }

  delete activeCheckoutSessions[mode];
  log.info(
    `[credit-handler] Cleared active ${mode} checkout ${sessionId}.`
  );
  return true;
}

function shouldEmitCheckoutUiTransition(
  mode: CheckoutMode,
  sessionId: string | null | undefined,
  transition: 'confirmed' | 'cancelled' | 'unresolved'
): boolean {
  const activeSessionId = getActiveCheckoutSessionId(mode);
  if (!activeSessionId) {
    if (!sessionId && transition === 'cancelled') {
      return true;
    }
    if (sessionId) {
      log.info(
        `[credit-handler] Ignoring ${mode} checkout ${transition} for ${sessionId}; no active ${mode} checkout is pending.`
      );
    }
    return false;
  }

  if (!sessionId) {
    log.info(
      `[credit-handler] Ignoring ${mode} checkout ${transition} without a checkout session id while ${activeSessionId} is active.`
    );
    return false;
  }

  if (activeSessionId !== sessionId) {
    log.info(
      `[credit-handler] Ignoring ${mode} checkout ${transition} for inactive session ${sessionId}; active session is ${activeSessionId}.`
    );
    return false;
  }

  return true;
}

function emitCheckoutCancelled(
  mode: CheckoutMode,
  targetWindow?: BrowserWindow | null,
  sessionId?: string | null
): void {
  if (!shouldEmitCheckoutUiTransition(mode, sessionId, 'cancelled')) {
    return;
  }

  clearActiveCheckoutSession(mode, sessionId);

  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (mode === 'byo') {
    targetWindow.webContents.send('byo-unlock-cancelled');
    return;
  }

  targetWindow.webContents.send('checkout-cancelled');
}

function emitCheckoutUnresolved(
  mode: CheckoutMode,
  targetWindow?: BrowserWindow | null,
  sessionId?: string | null
): void {
  if (!shouldEmitCheckoutUiTransition(mode, sessionId, 'unresolved')) {
    return;
  }

  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  targetWindow.webContents.send(
    mode === 'byo' ? 'byo-unlock-unresolved' : 'checkout-unresolved'
  );
}

function emitCheckoutConfirmed(
  sessionId: string | null | undefined,
  targetWindow?: BrowserWindow | null
): void {
  if (!shouldEmitCheckoutUiTransition('credits', sessionId, 'confirmed')) {
    return;
  }

  clearActiveCheckoutSession('credits', sessionId);

  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  targetWindow.webContents.send('checkout-confirmed');
}

function emitByoUnlockConfirmed(
  sessionId: string | null | undefined,
  snapshot: Awaited<ReturnType<typeof syncEntitlements>> | ReturnType<typeof setByoUnlocked>,
  targetWindow?: BrowserWindow | null
): void {
  if (!shouldEmitCheckoutUiTransition('byo', sessionId, 'confirmed')) {
    return;
  }

  clearActiveCheckoutSession('byo', sessionId);

  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  targetWindow.webContents.send('byo-unlock-confirmed', snapshot);
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
  alertOnSettlementTimeout?: boolean;
}

type CheckoutClientEventType =
  | 'embedded_cancel_redirect'
  | 'embedded_load_failure'
  | 'embedded_manual_close_unpaid'
  | 'embedded_manual_close_pending_timeout'
  | 'external_settlement_cancelled'
  | 'external_settlement_pending_timeout'
  | 'external_reconciliation_failed'
  | 'open_external_failed';

function getCheckoutLocaleHint(): string {
  const raw = settingsStore.get('app_language_preference', 'en');
  if (typeof raw !== 'string') return 'en';
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : 'en';
}

function getCheckoutCountryHint(): string | null {
  const rawLocale = (
    app.getPreferredSystemLanguages?.()[0] ||
    app.getLocale?.() ||
    ''
  );

  return resolveCheckoutCountryHintFromLocale(rawLocale);
}

let paymentEventStreamAbort: AbortController | null = null;
let paymentEventStreamConnecting = false;
let paymentEventStreamReconnectTimer: ReturnType<typeof setTimeout> | null =
  null;
let currentCreditSnapshot: CreditSnapshotPayload | null = null;
let creditBalanceHydrationPromise: Promise<CreditSnapshotPayload | null> | null =
  null;

function resolveCreditsPerHour(rawPerHour?: unknown): number {
  return Math.max(
    1,
    Number(process.env.CREDITS_PER_HOUR_OVERRIDE) ||
      Number(rawPerHour) ||
      store.get('creditsPerHour', CREDITS_PER_AUDIO_HOUR) ||
      CREDITS_PER_AUDIO_HOUR
  );
}

function buildCreditSnapshotPayload({
  credits,
  perHour,
  authoritative,
  checkoutSessionId = null,
}: {
  credits: number;
  perHour: number;
  authoritative: boolean;
  checkoutSessionId?: string | null;
}): CreditSnapshotPayload {
  return {
    creditBalance: credits,
    hoursBalance: credits / perHour,
    creditsPerHour: perHour,
    authoritative,
    checkoutSessionId,
  };
}

function buildCachedCreditSnapshot(): CreditSnapshotPayload {
  const credits = Math.max(0, Number(store.get('balanceCredits', 0)) || 0);
  const perHour = resolveCreditsPerHour(
    store.get('creditsPerHour', CREDITS_PER_AUDIO_HOUR)
  );

  return buildCreditSnapshotPayload({
    credits,
    perHour,
    authoritative: false,
  });
}

function getCreditSnapshotOverride(): CreditSnapshotPayload | null {
  const overrideRaw = process.env.CREDIT_BALANCE_OVERRIDE;
  const forceZero = process.env.FORCE_ZERO_CREDITS === '1';
  if (!forceZero && (!overrideRaw || overrideRaw.length === 0)) {
    return null;
  }

  const credits = forceZero ? 0 : Math.max(0, Number(overrideRaw) || 0);
  const perHour = resolveCreditsPerHour();

  return buildCreditSnapshotPayload({
    credits,
    perHour,
    authoritative: false,
  });
}

function publishCreditSnapshot({
  snapshot,
  targetWindow,
}: {
  snapshot: CreditSnapshotPayload;
  targetWindow?: BrowserWindow | null;
}): void {
  store.set('balanceCredits', snapshot.creditBalance);
  store.set('creditsPerHour', snapshot.creditsPerHour);
  currentCreditSnapshot = snapshot;

  const window = targetWindow ?? getMainWindow();
  if (!window || window.isDestroyed()) {
    return;
  }

  window.webContents.send('credits-updated', snapshot);
}

async function syncCreditBalanceFromServer(
  targetWindow?: BrowserWindow | null
): Promise<CreditSnapshotPayload | null> {
  const overrideSnapshot = getCreditSnapshotOverride();
  if (overrideSnapshot) {
    publishCreditSnapshot({ snapshot: overrideSnapshot, targetWindow });
    log.info(
      `[credit-handler] Using local credit snapshot override: balance=${overrideSnapshot.creditBalance}.`
    );
    return overrideSnapshot;
  }

  const deviceId = getDeviceId();
  const url = `${STAGE5_API_URL}/credits/${deviceId}`;
  log.info(
    `[credit-handler] Hydrating authoritative credit snapshot from ${url}.`
  );
  const response = await withStage5AuthRetry(authHeaders =>
    axios.get(url, {
      headers: authHeaders,
    })
  );

  throwIfStage5UpdateRequiredResponse({
    response,
    source: 'stage5-api',
  });

  if (typeof response.data?.creditBalance !== 'number') {
    return null;
  }

  sendNetLog('info', `GET /credits/${deviceId} -> ${response.status}`, {
    url,
    method: 'GET',
    status: response.status,
  });

  const snapshot = buildCreditSnapshotPayload({
    credits: Number(response.data.creditBalance) || 0,
    perHour: resolveCreditsPerHour(response.data?.creditsPerHour),
    authoritative: true,
  });

  publishCreditSnapshot({ snapshot, targetWindow });
  log.info(
    `[credit-handler] Published authoritative credit snapshot from /credits: balance=${snapshot.creditBalance}.`
  );
  return snapshot;
}

function requestCreditBalanceHydration(
  targetWindow?: BrowserWindow | null
): Promise<CreditSnapshotPayload | null> {
  if (creditBalanceHydrationPromise) {
    return creditBalanceHydrationPromise;
  }

  creditBalanceHydrationPromise = syncCreditBalanceFromServer(targetWindow)
    .catch(error => {
      if (isStage5UpdateRequiredError(error)) {
        throw error;
      }
      log.warn('[credit-handler] Failed to hydrate credit balance:', error);
      return null;
    })
    .finally(() => {
      creditBalanceHydrationPromise = null;
    });

  return creditBalanceHydrationPromise;
}

export async function initializeCreditBalanceState(
  targetWindow?: BrowserWindow | null
): Promise<void> {
  ensurePaymentEventStream();
  await requestCreditBalanceHydration(targetWindow);
}

export async function handleGetCreditSnapshot(): Promise<CreditSnapshotPayload | null> {
  ensurePaymentEventStream();
  if (currentCreditSnapshot) {
    log.info(
      `[credit-handler] Returning cached credit snapshot: balance=${currentCreditSnapshot.creditBalance}.`
    );
    return currentCreditSnapshot;
  }
  log.info('[credit-handler] No cached credit snapshot yet; awaiting hydration.');
  const hydratedSnapshot = await requestCreditBalanceHydration();
  if (hydratedSnapshot) {
    return hydratedSnapshot;
  }

  const fallbackSnapshot = buildCachedCreditSnapshot();
  currentCreditSnapshot = fallbackSnapshot;
  log.info(
    `[credit-handler] Falling back to locally cached credit snapshot: balance=${fallbackSnapshot.creditBalance}.`
  );
  return fallbackSnapshot;
}

export async function handleRefreshCreditSnapshot(): Promise<CreditSnapshotPayload | null> {
  ensurePaymentEventStream();
  const refreshedSnapshot = await requestCreditBalanceHydration(getMainWindow());
  if (refreshedSnapshot) {
    return refreshedSnapshot;
  }

  return currentCreditSnapshot ?? buildCachedCreditSnapshot();
}

function schedulePaymentEventStreamReconnect(delayMs = 5_000): void {
  if (paymentEventStreamReconnectTimer) {
    return;
  }

  paymentEventStreamReconnectTimer = setTimeout(() => {
    paymentEventStreamReconnectTimer = null;
    ensurePaymentEventStream();
  }, delayMs);
}

function ensurePaymentEventStream(): void {
  if (paymentEventStreamAbort || paymentEventStreamConnecting) {
    return;
  }

  const controller = new AbortController();
  let shouldReconnect = true;
  paymentEventStreamAbort = controller;
  paymentEventStreamConnecting = true;

  void connectPaymentEventStream(controller)
    .catch(error => {
      if (isStage5UpdateRequiredError(error)) {
        shouldReconnect = false;
        return;
      }
      if (isPaymentEventStreamUnavailableError(error)) {
        shouldReconnect = false;
        log.info(
          `[credit-handler] Payment event stream is unavailable. Falling back to polling-only credit reconciliation.`
        );
        return;
      }
      log.warn('[credit-handler] Payment event stream disconnected:', error);
    })
    .finally(() => {
      if (paymentEventStreamAbort === controller) {
        paymentEventStreamAbort = null;
      }
      paymentEventStreamConnecting = false;
      if (shouldReconnect && !controller.signal.aborted) {
        schedulePaymentEventStreamReconnect();
      }
    });
}

async function connectPaymentEventStream(
  controller: AbortController
): Promise<void> {
  const deviceId = getDeviceId();
  const url = `${STAGE5_API_URL}/payments/events/${encodeURIComponent(deviceId)}`;
  log.info(`[credit-handler] Connecting payment event stream for ${deviceId}.`);

  const response = await withStage5AuthRetryOnResponse(authHeaders =>
    fetch(url, {
      headers: {
        ...authHeaders,
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
    })
  );

  if (response.status === 426) {
    let data: any = null;
    try {
      data = await response.clone().json();
    } catch {
      data = null;
    }
    throwIfStage5UpdateRequiredResponse({
      response: { status: response.status, data },
      source: 'stage5-api',
    });
  }

  if (response.status === 503) {
    let data: any = null;
    try {
      data = await response.clone().json();
    } catch {
      data = null;
    }

    if (
      data?.error === 'Payment event stream unavailable' ||
      data?.message === 'Server push is not configured for this environment'
    ) {
      throw new PaymentEventStreamUnavailableError(
        data?.message || 'Server push is not configured for this environment'
      );
    }
  }

  if (!response.ok) {
    throw new Error(`Payment event stream failed with HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error('Payment event stream response did not include a body');
  }

  sendNetLog('info', `GET /payments/events/${deviceId} -> ${response.status}`, {
    url,
    method: 'GET',
    status: response.status,
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (!controller.signal.aborted) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = processPaymentEventStreamBuffer(buffer);
  }
}

function processPaymentEventStreamBuffer(buffer: string): string {
  let remaining = buffer;
  let separatorIndex = remaining.search(/\r?\n\r?\n/);

  while (separatorIndex >= 0) {
    const block = remaining.slice(0, separatorIndex);
    const separatorMatch = remaining.slice(separatorIndex).match(/^\r?\n\r?\n/);
    const separatorLength = separatorMatch?.[0]?.length ?? 2;
    remaining = remaining.slice(separatorIndex + separatorLength);
    handlePaymentEventStreamBlock(block);
    separatorIndex = remaining.search(/\r?\n\r?\n/);
  }

  return remaining;
}

function handlePaymentEventStreamBlock(block: string): void {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) {
      continue;
    }
    const separatorIndex = line.indexOf(':');
    const field =
      separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    let value = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : '';
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    if (field === 'data') {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) {
    return;
  }

  const payloadText = dataLines.join('\n');

  try {
    const payload = JSON.parse(payloadText);
    tracePaymentEventReceipt(
      'info',
      `[credit-handler] Received payment event stream payload: ${typeof payload?.type === 'string' ? payload.type : 'unknown'}`,
      {
        payload,
      }
    );
    handlePaymentRealtimeEvent(payload);
  } catch (error) {
    tracePaymentEventReceipt(
      'warn',
      '[credit-handler] Failed to parse payment event stream payload.',
      {
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
        block,
        payloadText,
      }
    );
  }
}

function handlePaymentRealtimeEvent(event: any): void {
  const eventType = typeof event?.type === 'string' ? event.type : '';
  if (!eventType || eventType === 'ready') {
    return;
  }

  if (eventType === 'credits.updated') {
    const credits = Number(event?.balanceAfter);
    if (!Number.isFinite(credits)) {
      return;
    }
    const snapshot = buildCreditSnapshotPayload({
      credits,
      perHour: resolveCreditsPerHour(event?.creditsPerHour),
      authoritative: true,
      checkoutSessionId: event?.checkoutSessionId ?? null,
    });

    publishCreditSnapshot({
      snapshot,
    });
    emitCheckoutConfirmed(event?.checkoutSessionId ?? null, getMainWindow());

    log.info(
      `[credit-handler] Applied authoritative payment credit event: balance=${credits}, session=${event?.checkoutSessionId ?? 'n/a'}, paymentIntent=${event?.paymentIntentId ?? 'n/a'}.`
    );
    return;
  }

  if (eventType === 'entitlements.updated') {
    const snapshot = setByoUnlocked(
      {
        byoOpenAi: Boolean(event?.entitlements?.byoOpenAi),
        byoAnthropic: Boolean(event?.entitlements?.byoAnthropic),
        byoElevenLabs: Boolean(event?.entitlements?.byoElevenLabs),
      },
      { notify: true }
    );
    const mainWindow = getMainWindow();
    emitByoUnlockConfirmed(event?.checkoutSessionId ?? null, snapshot, mainWindow);
    log.info(
      `[credit-handler] Applied authoritative BYO entitlement event: openai=${snapshot.byoOpenAi}, session=${event?.checkoutSessionId ?? 'n/a'}.`
    );
    return;
  }

  if (eventType === 'checkout.failed') {
    const mainWindow = getMainWindow();
    const mode = event?.mode === 'byo' ? 'byo' : 'credits';
    const sessionId =
      typeof event?.checkoutSessionId === 'string'
        ? event.checkoutSessionId
        : getActiveCheckoutSessionId(mode);
    emitCheckoutCancelled(mode, mainWindow, sessionId);
    log.warn(
      `[credit-handler] Payment checkout failed via webhook event (mode=${mode}, session=${sessionId ?? 'n/a'}, paymentIntent=${event?.paymentIntentId ?? 'n/a'}): ${event?.message ?? 'no message'}`
    );
  }
}

function reportCheckoutClientEventInBackground({
  eventType,
  sessionId,
  mode,
  packId,
  message,
}: {
  eventType: CheckoutClientEventType;
  sessionId?: string | null;
  mode: CheckoutMode;
  packId?: CreditPackId;
  message?: string;
}): void {
  if (!sessionId) {
    return;
  }

  void (async () => {
    try {
      const apiUrl = `${STAGE5_API_URL}/payments/checkout-event`;
      await withStage5AuthRetry(authHeaders =>
        axios.post(
          apiUrl,
          {
            sessionId,
            eventType,
            mode,
            packId,
            entitlement: mode === 'byo' ? 'byo_openai' : undefined,
            message,
          },
          {
            headers: authHeaders,
            timeout: 10_000,
          }
        )
      );
    } catch (error) {
      if (isStage5UpdateRequiredError(error)) {
        return;
      }
      log.warn(
        `[credit-handler] Failed to report checkout client event ${eventType} for ${sessionId}:`,
        error
      );
    }
  })();
}

async function resolveCheckoutReturnSession(
  returnId?: string | null
): Promise<{ sessionId: string; mode: CheckoutMode } | null> {
  const normalizedReturnId = String(returnId || '').trim();
  if (!normalizedReturnId) {
    return null;
  }

  const apiUrl = `${STAGE5_API_URL}/payments/checkout-return/${encodeURIComponent(normalizedReturnId)}`;
  const response = await withStage5AuthRetry(authHeaders =>
    axios.get(apiUrl, {
      headers: authHeaders,
      timeout: 10_000,
    })
  );
  const sessionId =
    typeof response.data?.sessionId === 'string'
      ? response.data.sessionId.trim()
      : '';
  if (!sessionId) {
    return null;
  }

  return {
    sessionId,
    mode: response.data?.mode === 'byo' ? 'byo' : 'credits',
  };
}

export async function handleCreateCheckoutSession(
  _evt: Electron.IpcMainInvokeEvent,
  packId: CreditPackId
): Promise<string | null> {
  ensurePaymentEventStream();

  try {
    const mainWindow = getMainWindow();
    const baselineCredits =
      currentCreditSnapshot?.authoritative === true
        ? currentCreditSnapshot.creditBalance
        : undefined;
    const expectedCredits =
      typeof baselineCredits === 'number'
        ? baselineCredits + PACK_CREDITS[packId]
        : undefined;
    if (typeof baselineCredits !== 'number') {
      log.info(
        `[credit-handler] Starting checkout for ${packId} without an authoritative local credit baseline; hydrating balance in the background.`
      );
      void requestCreditBalanceHydration(mainWindow).catch(error => {
        log.warn(
          `[credit-handler] Background credit balance hydration before checkout failed for ${packId}:`,
          error
        );
      });
    }
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
          country: getCheckoutCountryHint() ?? undefined,
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
      const checkoutSessionId =
        typeof response.data?.sessionId === 'string'
          ? response.data.sessionId
          : null;
      log.info(
        `[credit-handler] Checkout session received (${getCheckoutLogLabel(checkoutSessionId)}).`
      );

      // Emit checkout-pending event so UI can show "syncing balance..." until webhook lands
      setActiveCheckoutSession('credits', checkoutSessionId);
      if (mainWindow) {
        mainWindow.webContents.send('checkout-pending');
      }

      if (checkoutSessionId && !shouldUseEmbeddedCheckoutWindow()) {
        await openStripeCheckoutInExternalBrowser({
          sessionUrl: response.data.url,
          sessionId: checkoutSessionId,
          mode: 'credits',
          window: mainWindow ?? null,
          baselineCredits,
          expectedCredits,
          packId,
        });
        return checkoutSessionId;
      }

      let settlementCheckInFlight = false;

      // Optional fallback for debugging the legacy embedded checkout window.
      await openStripeCheckout({
        sessionUrl: response.data.url,
        defaultMode: 'credits',
        sessionId: checkoutSessionId,
        packId,
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
              reportCheckoutClientEventInBackground({
                eventType: 'embedded_manual_close_unpaid',
                sessionId,
                mode,
                packId,
              });
              emitCheckoutCancelled(mode, mainWindow ?? null, sessionId);
            }

            return shouldCloseCheckoutWindow(result);
          } finally {
            settlementCheckInFlight = false;
          }
        },
        onCancel: () => {
          emitCheckoutCancelled(
            'credits',
            mainWindow ?? null,
            checkoutSessionId
          );
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
                reportCheckoutClientEventInBackground({
                  eventType: 'embedded_manual_close_unpaid',
                  sessionId: checkoutSessionId,
                  mode: 'credits',
                  packId,
                });
                emitCheckoutCancelled(
                  'credits',
                  mainWindow ?? null,
                  checkoutSessionId
                );
                log.info(
                  `[credit-handler] Checkout ${checkoutSessionId} was not paid during post-close reconciliation.`
                );
              } else {
                reportCheckoutClientEventInBackground({
                  eventType: 'embedded_manual_close_pending_timeout',
                  sessionId: checkoutSessionId,
                  mode: 'credits',
                  packId,
                  message:
                    'Payment did not settle before the post-close reconciliation window ended.',
                });
                emitCheckoutCancelled(
                  'credits',
                  mainWindow ?? null,
                  checkoutSessionId
                );
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
      return checkoutSessionId;
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
  ensurePaymentEventStream();

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
          country: getCheckoutCountryHint() ?? undefined,
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
    log.info(
      `[credit-handler] BYO checkout session received (${getCheckoutLogLabel(checkoutSessionId)}).`
    );
    setActiveCheckoutSession('byo', checkoutSessionId);

    if (checkoutSessionId && !shouldUseEmbeddedCheckoutWindow()) {
      await openStripeCheckoutInExternalBrowser({
        sessionUrl: checkoutUrl,
        sessionId: checkoutSessionId,
        mode: 'byo',
        window: mainWindow,
      });
      return;
    }

    let settlementCheckInFlight = false;

    await openStripeCheckout({
      sessionUrl: checkoutUrl,
      defaultMode: 'byo',
      sessionId: checkoutSessionId,
      onSuccess: async ({ sessionId, mode }) => {
        settlementCheckInFlight = true;
        try {
          const result = await handleStripeSuccess(sessionId, {
            mode,
            window: mainWindow,
          });

          if (isCheckoutCancelled(result)) {
            reportCheckoutClientEventInBackground({
              eventType: 'embedded_manual_close_unpaid',
              sessionId,
              mode,
            });
            emitCheckoutCancelled(mode, mainWindow, sessionId);
          }

          return shouldCloseCheckoutWindow(result);
        } finally {
          settlementCheckInFlight = false;
        }
      },
      onCancel: () => {
        emitCheckoutCancelled('byo', mainWindow, checkoutSessionId);
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
              reportCheckoutClientEventInBackground({
                eventType: 'embedded_manual_close_unpaid',
                sessionId: checkoutSessionId,
                mode: 'byo',
              });
              emitCheckoutCancelled('byo', mainWindow, checkoutSessionId);
              log.info(
                `[credit-handler] BYO checkout ${checkoutSessionId} was not paid during post-close reconciliation.`
              );
            } else {
              reportCheckoutClientEventInBackground({
                eventType: 'embedded_manual_close_pending_timeout',
                sessionId: checkoutSessionId,
                mode: 'byo',
                message:
                  'Payment did not settle before the post-close reconciliation window ended.',
              });
              emitCheckoutCancelled('byo', mainWindow, checkoutSessionId);
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

export function handleCheckoutReturnFromBrowser({
  status,
  sessionId,
  returnId,
  mode,
}: {
  status: 'success' | 'cancelled';
  sessionId?: string | null;
  returnId?: string | null;
  mode?: CheckoutMode | string | null;
}): void {
  ensurePaymentEventStream();

  void (async () => {
    let checkoutMode: CheckoutMode = mode === 'byo' ? 'byo' : 'credits';
    let checkoutSessionId =
      typeof sessionId === 'string' && sessionId.trim()
        ? sessionId.trim()
        : null;
    const mainWindow = getMainWindow();

    if (!checkoutSessionId && returnId) {
      try {
        const resolved = await resolveCheckoutReturnSession(returnId);
        if (resolved) {
          checkoutSessionId = resolved.sessionId;
          checkoutMode = resolved.mode;
        }
      } catch (error) {
        if (isStage5UpdateRequiredError(error)) {
          return;
        }
        log.warn(
          `[credit-handler] Failed to resolve checkout return id ${returnId}:`,
          error
        );
      }
    }

    if (status === 'cancelled') {
      if (!checkoutSessionId) {
        log.warn(
          `[credit-handler] Ignoring ${checkoutMode} checkout cancel return without a checkout session id.`
        );
        return;
      }

      reportCheckoutClientEventInBackground({
        eventType: 'external_settlement_cancelled',
        sessionId: checkoutSessionId,
        mode: checkoutMode,
      });
      emitCheckoutCancelled(checkoutMode, mainWindow, checkoutSessionId);
      return;
    }

    if (!checkoutSessionId) {
      log.warn(
        '[credit-handler] Checkout return link opened without a checkout session id.'
      );
      return;
    }

    scheduleExternalCheckoutSettlementFollowUp(checkoutSessionId, {
      mode: checkoutMode,
      window: mainWindow,
      alertOnSettlementTimeout: true,
    });
  })();
}

interface StripeCheckoutOptions {
  sessionUrl: string;
  defaultMode: CheckoutMode;
  sessionId?: string | null;
  packId?: CreditPackId;
  onSuccess?: (payload: {
    sessionId?: string | null;
    mode: CheckoutMode;
    url: string;
  }) => boolean | void | Promise<boolean | void>;
  onCancel?: () => void;
  onClosed?: () => void;
}

async function openStripeCheckoutInExternalBrowser(
  options: CheckoutFollowUpOptions & {
    sessionUrl: string;
    sessionId: string;
  }
): Promise<void> {
  const { sessionUrl, sessionId, mode } = options;

  // South Korean cards, wallets, and 3DS flows can redirect to local processors.
  // The system browser handles those authentication hops more reliably than Electron WebContents.
  log.info(
    `[credit-handler] Opening ${mode} checkout ${sessionId} in the system browser.`
  );

  try {
    await shell.openExternal(sessionUrl);
  } catch (error) {
    reportCheckoutClientEventInBackground({
      eventType: 'open_external_failed',
      sessionId,
      mode,
      packId: options.packId,
      message: error instanceof Error ? error.message : String(error),
    });
    emitCheckoutCancelled(mode, options.window ?? null, sessionId);
    log.error(
      `[credit-handler] Failed to open ${mode} checkout ${sessionId} in the system browser:`,
      error
    );
    throw error;
  }

  scheduleExternalCheckoutSettlementFollowUp(sessionId, options);
}

function scheduleExternalCheckoutSettlementFollowUp(
  sessionId: string,
  opts: CheckoutFollowUpOptions
): void {
  const key = buildCheckoutFollowUpKey(opts.mode, sessionId);
  if (externalCheckoutSettlementFollowUps.has(key)) {
    return;
  }

  externalCheckoutSettlementFollowUps.add(key);
  void (async () => {
    try {
      const result = await handleStripeSuccess(sessionId, {
        mode: opts.mode,
        window: opts.window,
        baselineCredits: opts.baselineCredits,
        expectedCredits: opts.expectedCredits,
        packId: opts.packId,
        settlementMaxWaitMs: CHECKOUT_EXTERNAL_FOREGROUND_SETTLEMENT_MAX_WAIT_MS,
      });

      if (result.status === 'confirmed') {
        log.info(
          `[credit-handler] External ${opts.mode} checkout confirmed ${sessionId}.`
        );
      } else if (result.status === 'settled_pending_sync') {
        log.info(
          `[credit-handler] External ${opts.mode} checkout settled ${sessionId}; local visibility sync is still pending.`
        );
      } else if (result.status === 'cancelled') {
        reportCheckoutClientEventInBackground({
          eventType: 'external_settlement_cancelled',
          sessionId,
          mode: opts.mode,
          packId: opts.packId,
        });
        emitCheckoutCancelled(opts.mode, opts.window ?? null, sessionId);
        log.info(
          `[credit-handler] External ${opts.mode} checkout ${sessionId} was not paid.`
        );
      } else {
        emitCheckoutUnresolved(opts.mode, opts.window ?? null, sessionId);
        scheduleCheckoutSettlementFollowUp(sessionId, {
          ...opts,
          alertOnSettlementTimeout: true,
        });
        log.info(
          `[credit-handler] External ${opts.mode} checkout ${sessionId} is still unresolved after the foreground polling window. Marking checkout unresolved and continuing reconciliation in the background.`
        );
      }
    } catch (error: any) {
      if (isStage5UpdateRequiredError(error)) {
        return;
      }
      reportCheckoutClientEventInBackground({
        eventType: 'external_reconciliation_failed',
        sessionId,
        mode: opts.mode,
        packId: opts.packId,
        message: error?.message || String(error),
      });
      emitCheckoutUnresolved(opts.mode, opts.window ?? null, sessionId);
      scheduleCheckoutSettlementFollowUp(sessionId, opts);
      log.error(
        `[credit-handler] External ${opts.mode} checkout reconciliation failed for ${sessionId}. Keeping checkout unresolved and continuing background settlement follow-up:`,
        error
      );
    } finally {
      externalCheckoutSettlementFollowUps.delete(key);
    }
  })();
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
          const mode = parseMode(
            targetUrl.searchParams.get('mode') ?? options.defaultMode
          );
          reportCheckoutClientEventInBackground({
            eventType: 'embedded_cancel_redirect',
            sessionId: options.sessionId,
            mode,
            packId: options.packId,
          });
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
      reportCheckoutClientEventInBackground({
        eventType: 'embedded_load_failure',
        sessionId: options.sessionId,
        mode: options.defaultMode,
        packId: options.packId,
        message: `${errorCode} ${errorDescription}`,
      });
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
      await requestCreditBalanceHydration(getMainWindow());

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
      await requestCreditBalanceHydration(getMainWindow());

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
  fulfillmentStatus?: string | null;
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
      timeout: CHECKOUT_SETTLEMENT_POLL_REQUEST_TIMEOUT_MS,
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
        fulfillmentStatus:
          (response.data?.fulfillmentStatus as string | null) ?? null,
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
        if (state.fulfillmentStatus === 'fulfilled') {
          return { paid: true, timedOut: false, state };
        }
        if (
          state.fulfillmentStatus === 'failed' ||
          state.fulfillmentStatus === 'cancelled'
        ) {
          return { paid: false, timedOut: false, state };
        }
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
  const visibleBaselineCredits =
    currentCreditSnapshot?.creditBalance ??
    Math.max(0, Number(store.get('balanceCredits', 0)) || 0);

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
      const perHour = resolveCreditsPerHour(response.data?.creditsPerHour);
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
        publishCreditSnapshot({
          snapshot: buildCreditSnapshotPayload({
            credits,
            perHour,
            authoritative: true,
            checkoutSessionId: sessionId,
          }),
          targetWindow,
        });
        emitCheckoutConfirmed(sessionId, targetWindow);
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
            if (noBaselineExpectation) {
              log.info(
                `[credit-handler] Confirmed top-up via ledger reconciliation for checkout ${sessionId} without an authoritative pre-checkout baseline (credits=${credits}, visibleBaseline=${visibleBaselineCredits}, pack=${packId}).`
              );
              publishCreditSnapshot({
                snapshot: buildCreditSnapshotPayload({
                  credits,
                  perHour,
                  authoritative: true,
                  checkoutSessionId: sessionId,
                }),
                targetWindow,
              });
              emitCheckoutConfirmed(sessionId, targetWindow);
              return true;
            }

            log.info(
              `[credit-handler] Confirmed top-up via ledger reconciliation for checkout ${sessionId} with a known baseline (credits=${credits}, expected>=${expectedCredits ?? 'n/a'}, baseline=${baselineCredits ?? 'n/a'}).`
            );
            publishCreditSnapshot({
              snapshot: buildCreditSnapshotPayload({
                credits,
                perHour,
                authoritative: true,
                checkoutSessionId: sessionId,
              }),
              targetWindow,
            });
            emitCheckoutConfirmed(sessionId, targetWindow);
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
      emitByoUnlockConfirmed(sessionId, snapshot, targetWindow);
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
          emitCheckoutUnresolved(opts.mode, opts.window ?? null, sessionId);
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
        emitCheckoutUnresolved(opts.mode, opts.window ?? null, sessionId);
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
        emitCheckoutCancelled(opts.mode, opts.window ?? null, sessionId);
        log.info(
          `[credit-handler] Background ${opts.mode} settlement reconciliation determined ${sessionId} was not paid.`
        );
      } else {
        if (opts.alertOnSettlementTimeout) {
          reportCheckoutClientEventInBackground({
            eventType: 'external_settlement_pending_timeout',
            sessionId,
            mode: opts.mode,
            packId: opts.packId,
            message:
              'Payment did not settle before the background checkout reconciliation window ended.',
          });
        }
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

import { randomUUID } from 'node:crypto';
import nodeProcess from 'node:process';
import axios from 'axios';
import { app, webContents } from 'electron';
import { createAnalyticsPreferenceController } from './analytics-preference-controller.js';
import { isFreshProductEvent } from './product-event-retention.js';
import Store from 'electron-store';
import log from 'electron-log';
import { STAGE5_API_URL } from './endpoints.js';
import { withStage5AuthRetry } from './stage5-auth.js';
import type { TranslationFunnelEvent } from './translation-funnel.js';
import type { TranscriptionFunnelEvent } from './transcription-funnel.js';
import type { DubbingFunnelEvent } from './dubbing-funnel.js';
import type { SummaryFunnelEvent } from './summary-funnel.js';
import type { MergeFunnelEvent } from './merge-funnel.js';
import type {
  PurchaseFunnelEvent,
  CreditPackId,
  PurchasePlacement,
  PurchaseFailureReason,
} from './purchase-funnel.js';
import {
  acknowledgeCriticalFailure,
  listPendingCriticalFailures,
  type PendingCriticalFailure,
} from './startup-health.js';
import type {
  NeedCookiesCause,
  UrlConnectionContext,
  UrlDownloadFailureCategory,
  UrlDownloadFunnelEvent,
  UrlSourceType,
} from './url-download-funnel.js';
import { shouldSendProductAnalytics } from './product-analytics-policy.js';
import {
  queueProductEvent,
  listPendingProductEvents,
  acknowledgeProductEvent,
  clearAllPendingEvents,
} from './product-event-queue.js';

type MeaningfulUseFeature = 'video_open' | 'video_download' | 'translation';
type ProductEvent =
  | 'app_open'
  | 'app_meaningful_use'
  | 'app_critical_failure'
  | UrlDownloadFunnelEvent
  | TranslationFunnelEvent
  | TranscriptionFunnelEvent
  | DubbingFunnelEvent
  | SummaryFunnelEvent
  | MergeFunnelEvent
  | PurchaseFunnelEvent;
type TranslationWorkflow = 'full_srt';

type ProductMeasurementStore = {
  meaningfulUseReported?: boolean;
  pendingMeaningfulUseEventId?: string;
  pendingMeaningfulUseOccurredAt?: string;
};

const measurementStore = new Store<ProductMeasurementStore>({
  name: 'product-measurement',
});

const preferenceStore = new Store<{ enabled: boolean; revision: number }>({
  name: 'product-analytics-preference',
  defaults: { enabled: false, revision: 0 },
});

function releaseAnalyticsAvailable() {
  return shouldSendProductAnalytics({
    isPackaged: app.isPackaged,
    appVersion: app.getVersion(),
  });
}

function clearPendingAnalytics() {
  clearAllPendingEvents();
  for (const failure of listPendingCriticalFailures())
    acknowledgeCriticalFailure(failure.eventId);
  measurementStore.delete('pendingMeaningfulUseEventId');
  measurementStore.delete('pendingMeaningfulUseOccurredAt');
}

const privacy = createAnalyticsPreferenceController({
  read: () => ({
    enabled: preferenceStore.get('enabled') === true,
    revision: preferenceStore.get('revision'),
  }),
  write: choice => {
    preferenceStore.set(choice);
  },
  send: async choice => {
    const response = await withStage5AuthRetry(headers =>
      axios.post(`${STAGE5_API_URL}/analytics/preferences`, choice, {
        headers,
        timeout: 10_000,
      })
    );
    return response.data;
  },
  clearPending: clearPendingAnalytics,
  available: releaseAnalyticsAvailable,
  changed: state => {
    for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed())
        contents.send('analytics-privacy-changed', state);
    }
  },
});

export const getAnalyticsPrivacy = () => privacy.snapshot();
export const setAnalyticsPrivacy = (enabled: boolean) =>
  privacy.setEnabled(enabled);
export const syncAnalyticsPrivacy = () =>
  privacy.setEnabled(privacy.snapshot().enabled);

let maintenance: ReturnType<typeof setInterval> | undefined;
function prunePendingAnalytics() {
  listPendingProductEvents();
  listPendingCriticalFailures();
  if (
    !isFreshProductEvent(measurementStore.get('pendingMeaningfulUseOccurredAt'))
  ) {
    measurementStore.delete('pendingMeaningfulUseEventId');
    measurementStore.delete('pendingMeaningfulUseOccurredAt');
  }
  if (!privacy.snapshot().enabled) clearPendingAnalytics();
}
export async function initializeProductAnalytics() {
  // Purge legacy untimed queues, even when analytics remains disabled.
  prunePendingAnalytics();
  if (!maintenance) {
    maintenance = setInterval(
      () => {
        prunePendingAnalytics();
        void (async () => {
          if (privacy.snapshot().status === 'pending') await privacy.sync();
          await flushPendingCriticalFailures();
          await flushPendingProductEvents();
        })().catch(() => {});
      },
      15 * 60 * 1000
    );
    maintenance.unref();
  }
  await privacy.sync();
  await trackAppOpen();
  await flushPendingCriticalFailures();
  await flushPendingProductEvents();
}

let meaningfulUseInFlight: Promise<void> | null = null;

function productAnalyticsEnabled(): boolean {
  return privacy.maySend();
}

function measurementErrorLabel(error: unknown): string {
  const status = (error as { response?: { status?: unknown } })?.response
    ?.status;
  if (typeof status === 'number') return `HTTP ${status}`;
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && code ? code : 'network_error';
}

function normalizedLocale(): string {
  const locale = String(app.getLocale() || 'en')
    .trim()
    .replace(/_/g, '-');
  return /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(locale) ? locale : 'en';
}

function supportedPlatform(): 'darwin' | 'win32' | 'linux' {
  if (nodeProcess.platform === 'win32' || nodeProcess.platform === 'linux') {
    return nodeProcess.platform;
  }
  return 'darwin';
}

function supportedArchitecture(): 'arm64' | 'x64' | 'ia32' {
  if (nodeProcess.arch === 'arm64' || nodeProcess.arch === 'ia32') {
    return nodeProcess.arch;
  }
  return 'x64';
}

async function postProductEvent({
  eventId,
  event,
  occurredAt = new Date().toISOString(),
  consentRevision = privacy.snapshot().revision,
  feature,
  workflow,
  criticalFailure,
  urlDownload,
  purchase,
}: {
  eventId: string;
  event: ProductEvent;
  occurredAt?: string;
  consentRevision?: number;
  feature?: MeaningfulUseFeature;
  workflow?: TranslationWorkflow;
  criticalFailure?: PendingCriticalFailure;
  urlDownload?: {
    sourceType: UrlSourceType;
    cookieCause?: NeedCookiesCause;
    failureCategory?: UrlDownloadFailureCategory;
    connectionContext?: UrlConnectionContext;
    mediaFailure?: string;
  };
  purchase?: {
    packId?: CreditPackId;
    placement?: PurchasePlacement;
    failureReason?: PurchaseFailureReason;
  };
}): Promise<void> {
  const signal = privacy.signal();
  await withStage5AuthRetry(headers => {
    if (
      !privacy.maySend(consentRevision) ||
      signal.aborted ||
      !isFreshProductEvent(occurredAt)
    )
      throw new Error('analytics_not_allowed');
    return axios.post(
      `${STAGE5_API_URL}/analytics/events`,
      {
        eventId,
        event,
        occurredAt,
        consentRevision,
        appVersion: app.getVersion(),
        platform: supportedPlatform(),
        architecture: supportedArchitecture(),
        locale: normalizedLocale(),
        ...(feature ? { feature } : {}),
        ...(workflow ? { workflow } : {}),
        ...(criticalFailure
          ? {
              failureClass: criticalFailure.failureClass,
              startupPhase: criticalFailure.startupPhase,
              failedAppVersion: criticalFailure.failedAppVersion,
              failedPlatform: criticalFailure.failedPlatform,
              failedArchitecture: criticalFailure.failedArchitecture,
              ...(criticalFailure.processReason
                ? { processReason: criticalFailure.processReason }
                : {}),
            }
          : {}),
        ...(urlDownload
          ? {
              sourceType: urlDownload.sourceType,
              ...(urlDownload.cookieCause
                ? { cookieCause: urlDownload.cookieCause }
                : {}),
              ...(urlDownload.failureCategory
                ? { downloadFailure: urlDownload.failureCategory }
                : {}),
              ...(urlDownload.connectionContext
                ? { connectionContext: urlDownload.connectionContext }
                : {}),
              ...(urlDownload.mediaFailure
                ? { mediaFailure: urlDownload.mediaFailure }
                : {}),
            }
          : {}),
        ...(purchase
          ? {
              ...(purchase.packId ? { packId: purchase.packId } : {}),
              ...(purchase.placement ? { placement: purchase.placement } : {}),
              ...(purchase.failureReason
                ? { failureReason: purchase.failureReason }
                : {}),
            }
          : {}),
      },
      {
        headers,
        timeout: 10_000,
        signal,
      }
    );
  });
}

export async function flushPendingCriticalFailures(): Promise<void> {
  if (!productAnalyticsEnabled()) return;
  const consentRevision = privacy.snapshot().revision;
  for (const criticalFailure of listPendingCriticalFailures()) {
    if (!privacy.maySend(consentRevision)) return;
    if (!isFreshProductEvent(criticalFailure.occurredAt)) {
      acknowledgeCriticalFailure(criticalFailure.eventId);
      continue;
    }
    try {
      await postProductEvent({
        eventId: criticalFailure.eventId,
        event: 'app_critical_failure',
        occurredAt: criticalFailure.occurredAt,
        consentRevision,
        criticalFailure,
      });
      acknowledgeCriticalFailure(criticalFailure.eventId);
    } catch (error) {
      log.info(
        `[product-measurement] Critical-failure measurement remains pending for retry (${measurementErrorLabel(error)}).`
      );
      return;
    }
  }
}

export async function flushPendingProductEvents(): Promise<void> {
  if (!productAnalyticsEnabled()) return;
  // Match flushPendingCriticalFailures pattern: both require packaged + semver,
  // and both wait for authenticated session (via withStage5AuthRetry in postProductEvent).
  for (const queuedEvent of listPendingProductEvents()) {
    try {
      await postProductEvent(queuedEvent);
      acknowledgeProductEvent(queuedEvent.eventId);
    } catch (error) {
      log.info(
        `[product-measurement] Queued ${queuedEvent.event} remains pending for retry (${measurementErrorLabel(error)}).`
      );
      return;
    }
  }
}

export async function trackAppOpen(): Promise<void> {
  if (!productAnalyticsEnabled()) return;
  try {
    await postProductEvent({
      eventId: randomUUID(),
      event: 'app_open',
    });
  } catch (error) {
    log.info(
      `[product-measurement] App-open measurement was not recorded (${measurementErrorLabel(error)}).`
    );
  }
}

export function trackFirstMeaningfulUse(
  feature: MeaningfulUseFeature
): Promise<void> {
  if (!productAnalyticsEnabled()) return Promise.resolve();
  if (measurementStore.get('meaningfulUseReported') === true) {
    return Promise.resolve();
  }
  if (meaningfulUseInFlight) return meaningfulUseInFlight;

  const priorTime = measurementStore.get('pendingMeaningfulUseOccurredAt');
  const fresh = isFreshProductEvent(priorTime);
  const occurredAt = fresh ? priorTime! : new Date().toISOString();
  const consentRevision = privacy.snapshot().revision;
  const existingEventId = fresh
    ? measurementStore.get('pendingMeaningfulUseEventId')
    : undefined;
  const eventId =
    typeof existingEventId === 'string' && existingEventId.trim()
      ? existingEventId
      : randomUUID();
  measurementStore.set('pendingMeaningfulUseEventId', eventId);
  measurementStore.set('pendingMeaningfulUseOccurredAt', occurredAt);

  meaningfulUseInFlight = (async () => {
    try {
      await postProductEvent({
        eventId,
        event: 'app_meaningful_use',
        occurredAt,
        consentRevision,
        feature,
      });
      if (!privacy.maySend(consentRevision)) return;
      measurementStore.set('meaningfulUseReported', true);
      measurementStore.delete('pendingMeaningfulUseEventId');
      measurementStore.delete('pendingMeaningfulUseOccurredAt');
    } catch (error) {
      log.info(
        `[product-measurement] First meaningful use (${feature}) remains pending for retry (${measurementErrorLabel(error)}).`
      );
    } finally {
      meaningfulUseInFlight = null;
    }
  })();

  return meaningfulUseInFlight;
}

export async function trackTranslationFunnelEvent(
  event: TranslationFunnelEvent
): Promise<void> {
  if (!productAnalyticsEnabled()) return;
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const consentRevision = privacy.snapshot().revision;
  try {
    await postProductEvent({
      eventId,
      event,
      occurredAt,
      consentRevision,
      workflow: 'full_srt',
    });
  } catch (error) {
    log.info(
      `[product-measurement] ${event} measurement queued for retry (${measurementErrorLabel(error)}).`
    );
    if (!privacy.maySend(consentRevision)) return;
    queueProductEvent({
      eventId,
      occurredAt,
      consentRevision,
      event,
      workflow: 'full_srt',
    });
  }
}

export async function trackTranscriptionFunnelEvent(
  event: TranscriptionFunnelEvent
): Promise<void> {
  if (!productAnalyticsEnabled()) return;
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const consentRevision = privacy.snapshot().revision;
  try {
    await postProductEvent({
      eventId,
      event,
      occurredAt,
      consentRevision,
    });
  } catch (error) {
    log.info(
      `[product-measurement] ${event} measurement queued for retry (${measurementErrorLabel(error)}).`
    );
    if (!privacy.maySend(consentRevision)) return;
    queueProductEvent({ eventId, occurredAt, consentRevision, event });
  }
}

export async function trackDubbingFunnelEvent(
  event: DubbingFunnelEvent
): Promise<void> {
  if (!productAnalyticsEnabled()) return;
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const consentRevision = privacy.snapshot().revision;
  try {
    await postProductEvent({
      eventId,
      event,
      occurredAt,
      consentRevision,
    });
  } catch (error) {
    log.info(
      `[product-measurement] ${event} measurement queued for retry (${measurementErrorLabel(error)}).`
    );
    if (!privacy.maySend(consentRevision)) return;
    queueProductEvent({ eventId, occurredAt, consentRevision, event });
  }
}

export async function trackSummaryFunnelEvent(
  event: SummaryFunnelEvent
): Promise<void> {
  if (!productAnalyticsEnabled()) return;
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const consentRevision = privacy.snapshot().revision;
  try {
    await postProductEvent({
      eventId,
      event,
      occurredAt,
      consentRevision,
    });
  } catch (error) {
    log.info(
      `[product-measurement] ${event} measurement queued for retry (${measurementErrorLabel(error)}).`
    );
    if (!privacy.maySend(consentRevision)) return;
    queueProductEvent({ eventId, occurredAt, consentRevision, event });
  }
}

export async function trackMergeFunnelEvent(
  event: MergeFunnelEvent
): Promise<void> {
  if (!productAnalyticsEnabled()) return;
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const consentRevision = privacy.snapshot().revision;
  try {
    await postProductEvent({
      eventId,
      event,
      occurredAt,
      consentRevision,
    });
  } catch (error) {
    log.info(
      `[product-measurement] ${event} measurement queued for retry (${measurementErrorLabel(error)}).`
    );
    if (!privacy.maySend(consentRevision)) return;
    queueProductEvent({ eventId, occurredAt, consentRevision, event });
  }
}

export async function trackUrlDownloadFunnelEvent(
  event: UrlDownloadFunnelEvent,
  details: {
    sourceType: UrlSourceType;
    cookieCause?: NeedCookiesCause;
    failureCategory?: UrlDownloadFailureCategory;
    connectionContext?: UrlConnectionContext;
    mediaFailure?: string;
  }
): Promise<void> {
  if (!productAnalyticsEnabled()) return;
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const consentRevision = privacy.snapshot().revision;
  try {
    await postProductEvent({
      eventId,
      event,
      occurredAt,
      consentRevision,
      urlDownload: details,
    });
  } catch (error) {
    log.info(
      `[product-measurement] ${event} measurement queued for retry (${measurementErrorLabel(error)}).`
    );
    if (!privacy.maySend(consentRevision)) return;
    queueProductEvent({
      eventId,
      occurredAt,
      consentRevision,
      event,
      urlDownload: details,
    });
  }
}

export async function trackPurchaseFunnelEvent(
  event: PurchaseFunnelEvent,
  details: {
    packId?: CreditPackId;
    placement?: PurchasePlacement;
    failureReason?: PurchaseFailureReason;
  } = {}
): Promise<void> {
  if (!productAnalyticsEnabled()) return;
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const consentRevision = privacy.snapshot().revision;
  try {
    await postProductEvent({
      eventId,
      event,
      occurredAt,
      consentRevision,
      purchase: details,
    });
    // Flush failures immediately for visibility
    if (
      event === 'credit_checkout_failed' ||
      event === 'byo_unlock_failed' ||
      event === 'credit_checkout_cancelled' ||
      event === 'byo_unlock_cancelled'
    ) {
      log.info(`[product-measurement] ${event} flushed immediately.`);
    }
  } catch (error) {
    log.info(
      `[product-measurement] ${event} measurement queued for retry (${measurementErrorLabel(error)}).`
    );
    if (!privacy.maySend(consentRevision)) return;
    queueProductEvent({
      eventId,
      occurredAt,
      consentRevision,
      event,
      purchase: details,
    });
  }
}

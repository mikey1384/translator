import { randomUUID } from 'node:crypto';
import nodeProcess from 'node:process';
import axios from 'axios';
import { app } from 'electron';
import Store from 'electron-store';
import log from 'electron-log';
import { STAGE5_API_URL } from './endpoints.js';
import { withStage5AuthRetry } from './stage5-auth.js';
import type { TranslationFunnelEvent } from './translation-funnel.js';
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

type MeaningfulUseFeature = 'video_open' | 'video_download' | 'translation';
type ProductEvent =
  | 'app_open'
  | 'app_meaningful_use'
  | 'app_critical_failure'
  | UrlDownloadFunnelEvent
  | TranslationFunnelEvent;
type TranslationWorkflow = 'full_srt';

type ProductMeasurementStore = {
  meaningfulUseReported?: boolean;
  pendingMeaningfulUseEventId?: string;
};

const measurementStore = new Store<ProductMeasurementStore>({
  name: 'product-measurement',
});

let meaningfulUseInFlight: Promise<void> | null = null;

function productAnalyticsEnabled(): boolean {
  return shouldSendProductAnalytics({
    isPackaged: app.isPackaged,
    appVersion: app.getVersion(),
  });
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
  feature,
  workflow,
  criticalFailure,
  urlDownload,
}: {
  eventId: string;
  event: ProductEvent;
  feature?: MeaningfulUseFeature;
  workflow?: TranslationWorkflow;
  criticalFailure?: PendingCriticalFailure;
  urlDownload?: {
    sourceType: UrlSourceType;
    cookieCause?: NeedCookiesCause;
    failureCategory?: UrlDownloadFailureCategory;
    connectionContext?: UrlConnectionContext;
  };
}): Promise<void> {
  await withStage5AuthRetry(headers =>
    axios.post(
      `${STAGE5_API_URL}/analytics/events`,
      {
        eventId,
        event,
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
            }
          : {}),
      },
      {
        headers,
        timeout: 10_000,
      }
    )
  );
}

export async function flushPendingCriticalFailures(): Promise<void> {
  if (!productAnalyticsEnabled()) return;
  for (const criticalFailure of listPendingCriticalFailures()) {
    try {
      await postProductEvent({
        eventId: criticalFailure.eventId,
        event: 'app_critical_failure',
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

  const existingEventId = measurementStore.get('pendingMeaningfulUseEventId');
  const eventId =
    typeof existingEventId === 'string' && existingEventId.trim()
      ? existingEventId
      : randomUUID();
  measurementStore.set('pendingMeaningfulUseEventId', eventId);

  meaningfulUseInFlight = (async () => {
    try {
      await postProductEvent({
        eventId,
        event: 'app_meaningful_use',
        feature,
      });
      measurementStore.set('meaningfulUseReported', true);
      measurementStore.delete('pendingMeaningfulUseEventId');
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
  try {
    await postProductEvent({
      eventId: randomUUID(),
      event,
      workflow: 'full_srt',
    });
  } catch (error) {
    log.info(
      `[product-measurement] ${event} measurement was not recorded (${measurementErrorLabel(error)}).`
    );
  }
}

export async function trackUrlDownloadFunnelEvent(
  event: UrlDownloadFunnelEvent,
  details: {
    sourceType: UrlSourceType;
    cookieCause?: NeedCookiesCause;
    failureCategory?: UrlDownloadFailureCategory;
    connectionContext?: UrlConnectionContext;
  }
): Promise<void> {
  if (!productAnalyticsEnabled()) return;
  try {
    await postProductEvent({
      eventId: randomUUID(),
      event,
      urlDownload: details,
    });
  } catch (error) {
    log.info(
      `[product-measurement] ${event} measurement was not recorded (${measurementErrorLabel(error)}).`
    );
  }
}

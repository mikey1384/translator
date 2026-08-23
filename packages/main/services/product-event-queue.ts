import Store from 'electron-store';
import log from 'electron-log';
import type { TranslationFunnelEvent } from './translation-funnel.js';
import type { TranscriptionFunnelEvent } from './transcription-funnel.js';
import type { DubbingFunnelEvent } from './dubbing-funnel.js';
import type { SummaryFunnelEvent } from './summary-funnel.js';
import type { MergeFunnelEvent } from './merge-funnel.js';
import type {
  NeedCookiesCause,
  UrlConnectionContext,
  UrlDownloadFailureCategory,
  UrlDownloadFunnelEvent,
  UrlSourceType,
} from './url-download-funnel.js';
import type {
  CreditPackId,
  PurchaseFailureReason,
  PurchaseFunnelEvent,
  PurchasePlacement,
} from './purchase-funnel.js';

type QueuedProductEvent = {
  eventId: string;
  event:
    | TranslationFunnelEvent
    | TranscriptionFunnelEvent
    | DubbingFunnelEvent
    | SummaryFunnelEvent
    | MergeFunnelEvent
    | UrlDownloadFunnelEvent
    | PurchaseFunnelEvent;
  workflow?: 'full_srt';
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
};

type ProductEventQueueStore = {
  pendingEvents?: QueuedProductEvent[];
};

const MAX_QUEUE_SIZE = 100;

const eventQueue = new Store<ProductEventQueueStore>({
  name: 'product-event-queue',
});

export function queueProductEvent(event: QueuedProductEvent): void {
  const pending = eventQueue.get('pendingEvents') ?? [];

  // Cap the queue to prevent unbounded growth
  if (pending.length >= MAX_QUEUE_SIZE) {
    log.warn(
      `[product-event-queue] Queue at capacity (${MAX_QUEUE_SIZE}), dropping oldest event`
    );
    pending.shift();
  }

  pending.push(event);
  eventQueue.set('pendingEvents', pending);
}

export function listPendingProductEvents(): QueuedProductEvent[] {
  return eventQueue.get('pendingEvents') ?? [];
}

export function acknowledgeProductEvent(eventId: string): void {
  const pending = eventQueue.get('pendingEvents') ?? [];
  const filtered = pending.filter(e => e.eventId !== eventId);
  eventQueue.set('pendingEvents', filtered);
}

export function clearAllPendingEvents(): void {
  eventQueue.set('pendingEvents', []);
}

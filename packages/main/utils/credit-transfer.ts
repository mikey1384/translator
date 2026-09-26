// Pure helpers for moving purchased credits between devices and for reading
// the credit ledger. The IPC handlers in credit-handlers.ts do the network
// calls; everything here is testable without Electron.

export type CreditTransferErrorCode =
  | 'nothing_to_transfer'
  | 'too_many_codes'
  | 'jobs_running'
  | 'invalid_code'
  | 'same_device'
  | 'transfer_failed';

export type CreditTransferFailure = {
  success: false;
  error: CreditTransferErrorCode | string;
  message: string;
};

export type CreateTransferCodeResult =
  | {
      success: true;
      code: string;
      expiresInMinutes: number;
      transferableCredits: number;
      byoUnlock: boolean;
    }
  | CreditTransferFailure;

export type RedeemTransferResult =
  | {
      success: true;
      transferredCredits: number;
      creditBalance: number;
      byoUnlock: boolean;
    }
  | CreditTransferFailure;

const FALLBACK_TRANSFER_MESSAGE =
  'The credit transfer could not be completed. Check your connection and try again.';

function failureFrom(status: number, data: unknown): CreditTransferFailure {
  const body =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const error =
    typeof body.error === 'string' && body.error.trim()
      ? body.error.trim()
      : status === 0
        ? 'network_error'
        : 'transfer_failed';
  const message =
    typeof body.message === 'string' && body.message.trim()
      ? body.message.trim()
      : FALLBACK_TRANSFER_MESSAGE;
  return { success: false, error, message };
}

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function parseCreateTransferCodeResponse(
  status: number,
  data: unknown
): CreateTransferCodeResult {
  const body = (data ?? {}) as Record<string, unknown>;
  if (status !== 200 || typeof body.code !== 'string' || !body.code.trim()) {
    return failureFrom(status, data);
  }
  return {
    success: true,
    code: body.code.trim(),
    expiresInMinutes: toCount(body.expiresInMinutes) || 30,
    transferableCredits: toCount(body.transferableCredits),
    byoUnlock: body.byoUnlock === true,
  };
}

export function parseRedeemTransferResponse(
  status: number,
  data: unknown
): RedeemTransferResult {
  const body = (data ?? {}) as Record<string, unknown>;
  if (status !== 200 || typeof body.creditBalance !== 'number') {
    return failureFrom(status, data);
  }
  return {
    success: true,
    transferredCredits: toCount(body.transferredCredits),
    creditBalance: toCount(body.creditBalance),
    byoUnlock: body.byoUnlock === true,
  };
}

// Accepts what people paste: lower case, spaces, missing or extra dashes.
// The server normalizes too; this only keeps obviously empty input local.
export function normalizeTransferCodeInput(raw: unknown): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export type CreditHistorySummary = {
  // The device has received or spent credits at some point.
  everHadCredits: boolean;
  // Every credit the device ever received came from the one-time welcome grant.
  onlyWelcomeCredits: boolean;
};

// GET /credits/:deviceId/ledger returns the newest rows first, capped at 100.
export const CREDIT_LEDGER_PAGE_LIMIT = 100;

type LedgerRow = { delta?: unknown; reason?: unknown };

function isPaidGrant(reason: string): boolean {
  return (
    reason.startsWith('PACK_') ||
    reason === 'TRANSFER_IN' ||
    reason.startsWith('ADMIN')
  );
}

export function summarizeCreditLedger(
  rows: unknown,
  pageLimit = CREDIT_LEDGER_PAGE_LIMIT
): CreditHistorySummary | null {
  if (!Array.isArray(rows)) return null;
  let hasWelcome = false;
  let hasPaid = false;
  let hasMovement = false;
  for (const raw of rows as LedgerRow[]) {
    const delta = Number(raw?.delta);
    const reason = typeof raw?.reason === 'string' ? raw.reason.trim() : '';
    if (!Number.isFinite(delta) || delta === 0) continue;
    hasMovement = true;
    if (delta > 0 && reason === 'WELCOME') hasWelcome = true;
    if (delta > 0 && isPaidGrant(reason)) hasPaid = true;
  }
  // A full page may hide older purchases, so never claim "welcome only" then.
  const truncated = rows.length >= pageLimit;
  return {
    everHadCredits: hasMovement,
    onlyWelcomeCredits: hasWelcome && !hasPaid && !truncated,
  };
}

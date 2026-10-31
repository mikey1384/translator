import type { TFunction } from 'i18next';
import type { AppNotice } from '../state/modal-store';

export const CHECKOUT_SUPPORT_EMAIL = 'mikey@stage5.tools';

/**
 * What a buyer sees when the payment page couldn't be opened (no answer from
 * the server within the timeout, an error, or the browser failed to open):
 * what happened, a retry, and a person to write to. Never a dead end.
 */
export function buildCheckoutFailedNotice(t: TFunction): AppNotice {
  return {
    title: String(t('credits.checkoutFailed.title', 'Checkout didn’t open')),
    message: String(
      t(
        'credits.checkoutFailed.message',
        'Translator couldn’t reach the payment page. Check your internet connection and try again. If it keeps happening, email us at {{email}} and we’ll help you buy your minutes.',
        { email: CHECKOUT_SUPPORT_EMAIL }
      )
    ),
    buttons: [
      {
        id: 'close',
        label: String(t('common.close', 'Close')),
        variant: 'secondary',
      },
      {
        id: 'support',
        label: String(t('credits.checkoutFailed.contact', 'Contact support')),
        variant: 'secondary',
      },
      {
        id: 'retry',
        label: String(t('credits.checkoutFailed.retry', 'Try again')),
        variant: 'primary',
      },
    ],
  };
}

export function checkoutSupportMailto(t: TFunction): string {
  const subject = String(
    t(
      'credits.checkoutFailed.supportSubject',
      'I can’t buy minutes in Translator'
    )
  );
  return `mailto:${CHECKOUT_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/** Show the notice; resolves to what the user picked. */
export async function showCheckoutFailedNotice({
  t,
  openNotice,
  openExternal,
}: {
  t: TFunction;
  openNotice: (notice: AppNotice) => Promise<string | null>;
  openExternal: (url: string) => Promise<unknown>;
}): Promise<'retry' | 'support' | 'close'> {
  const choice = await openNotice(buildCheckoutFailedNotice(t));
  if (choice === 'support') {
    try {
      await openExternal(checkoutSupportMailto(t));
    } catch (error) {
      console.warn('[checkout] Could not open the mail app:', error);
    }
    return 'support';
  }
  return choice === 'retry' ? 'retry' : 'close';
}

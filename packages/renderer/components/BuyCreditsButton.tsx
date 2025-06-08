import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as SystemIPC from '@ipc/system';
import { useCreditStore } from '../state';

const TRUSTED_CHECKOUT_PATTERN =
  /^(https:\/\/(checkout\.stripe\.com|checkout\.paypal\.com|stage5\.tools\/checkout|your\.pspdomain\.com))\//;

interface BuyCreditsButtonProps {
  packId: 'STARTER' | 'STANDARD' | 'PRO';
  label: string;
}

export default function BuyCreditsButton({
  packId,
  label,
}: BuyCreditsButtonProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const { checkoutPending } = useCreditStore();

  async function handleClick() {
    try {
      setLoading(true);
      const url = await SystemIPC.createCheckoutSession(packId);
      if (url) {
        if (!window.env.isPackaged) {
          if (TRUSTED_CHECKOUT_PATTERN.test(url)) {
            await window.appShell.openExternal(url);
          } else {
            console.error('Untrusted checkout URL received:', url);
            await SystemIPC.showMessage(
              'Received an invalid checkout URL. Please contact support if this issue persists.'
            );
          }
        }
      } else {
        // null means the main process handled the checkout flow internally
        console.log('Checkout flow handled by main process.');
      }
    } catch (err: any) {
      console.error('Failed to start checkout:', err);
      if (err.stack) {
        console.error(err.stack);
      }
      await SystemIPC.showMessage(
        'An error occurred while trying to start checkout. Please check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  const isDisabled = loading || checkoutPending;

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      style={{
        padding: '10px 15px',
        cursor: isDisabled ? 'wait' : 'pointer',
        opacity: checkoutPending ? 0.7 : 1,
      }}
    >
      {loading
        ? t('credits.redirectingToPayment')
        : checkoutPending
          ? 'Processing...'
          : label}
    </button>
  );
}

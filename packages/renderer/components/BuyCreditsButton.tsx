import { useState } from 'react';
import { useTranslation } from 'react-i18next';
// import { shell } from 'electron'; // Removed direct shell import
import * as SystemIPC from '@ipc/system';

// Define the pattern outside the component so it's not re-compiled on every render/click.
// TODO: Update this pattern with your actual trusted PSP domain(s).
const TRUSTED_CHECKOUT_PATTERN =
  /^(https:\/\/(checkout\.stripe\.com|checkout\.paypal\.com|your\.pspdomain\.com))\//;

interface BuyCreditsButtonProps {
  packId: 'HOUR_5';
  // You might want to add a t function prop for i18n if this component is generic
  // t: (key: string) => string;
}

export default function BuyCreditsButton({ packId }: BuyCreditsButtonProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

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

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{ padding: '10px 15px', cursor: loading ? 'wait' : 'pointer' }}
    >
      {loading ? t('credits.redirectingToPayment') : t('credits.buyCredits')}
    </button>
  );
}

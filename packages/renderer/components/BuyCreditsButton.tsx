import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as SystemIPC from '@ipc/system';
import { useCreditStore } from '../state';

interface BuyCreditsButtonProps {
  packId: 'MICRO' | 'STARTER' | 'STANDARD' | 'PRO';
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
      await SystemIPC.createCheckoutSession(packId);

      await useCreditStore.getState().refresh();
    } catch (err: any) {
      console.error('Failed to start checkout:', err);
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

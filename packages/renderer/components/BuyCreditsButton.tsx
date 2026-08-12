import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as SystemIPC from '@ipc/system';
import { CHECKOUT_ALREADY_PENDING } from '../../shared/constants';
import Button, { type ButtonSize, type ButtonVariant } from './Button';

interface BuyCreditsButtonProps {
  packId: 'MICRO' | 'STARTER' | 'STANDARD' | 'PRO';
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  dataLog?: string;
  className?: string;
  onCheckoutCreated?: () => void;
}

export default function BuyCreditsButton({
  packId,
  label,
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  dataLog,
  className,
  onCheckoutCreated,
}: BuyCreditsButtonProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) {
      return;
    }

    try {
      setLoading(true);
      const checkoutSessionId = await SystemIPC.createCheckoutSession(packId);
      if (checkoutSessionId === CHECKOUT_ALREADY_PENDING) {
        // A checkout is already in flight (possibly from another tab); the
        // re-broadcast pending/unresolved event drives the UI — no error.
        onCheckoutCreated?.();
        return;
      }
      if (!checkoutSessionId) {
        await SystemIPC.showMessage(
          'An error occurred while trying to start checkout. Please check your connection and try again.'
        );
        return;
      }
      onCheckoutCreated?.();
    } catch (err: any) {
      console.error('Failed to start checkout:', err);
      await SystemIPC.showMessage(
        'An error occurred while trying to start checkout. Please check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  const isDisabled = loading;

  return (
    <Button
      onClick={handleClick}
      disabled={isDisabled}
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      className={className}
      data-log={dataLog}
    >
      {loading ? t('credits.redirectingToPayment') : label}
    </Button>
  );
}

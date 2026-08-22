import { useState, useEffect } from 'react';
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
  placement?: 'zero-credit-banner' | 'credit-ran-out-dialog' | 'settings-credit-card';
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
  placement,
  onCheckoutCreated,
}: BuyCreditsButtonProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Track button shown once on mount
    window.electron.trackPurchaseEvent?.('credit_checkout_button_shown', {
      packId,
      placement,
    }).catch(() => {
      // Ignore tracking errors
    });
  }, [packId, placement]);

  async function handleClick() {
    if (loading) {
      return;
    }

    // Track button press
    window.electron.trackPurchaseEvent?.('credit_checkout_button_clicked', {
      packId,
      placement,
    }).catch(() => {
      // Ignore tracking errors
    });

    try {
      setLoading(true);
      const checkoutSessionId = await SystemIPC.createCheckoutSession(packId);
      if (checkoutSessionId === CHECKOUT_ALREADY_PENDING) {
        // A checkout is already in flight (possibly from another tab); the
        // re-broadcast pending/unresolved event drives the UI — no error.
        // Track as failed with already_pending reason
        window.electron.trackPurchaseEvent?.('credit_checkout_failed', {
          packId,
          placement,
          failureReason: 'already_pending',
        }).catch(() => {
          // Ignore tracking errors
        });
        onCheckoutCreated?.();
        return;
      }
      if (!checkoutSessionId) {
        // Session creation failed - track failure
        window.electron.trackPurchaseEvent?.('credit_checkout_failed', {
          packId,
          placement,
          failureReason: 'api_error',
        }).catch(() => {
          // Ignore tracking errors
        });
        await SystemIPC.showMessage(
          'An error occurred while trying to start checkout. Please check your connection and try again.'
        );
        return;
      }
      onCheckoutCreated?.();
    } catch (err: any) {
      console.error('Failed to start checkout:', err);
      // Track session creation failure
      const failureReason = String(err).includes('network')
        ? 'network_error'
        : 'api_error';
      window.electron.trackPurchaseEvent?.('credit_checkout_failed', {
        packId,
        placement,
        failureReason,
      }).catch(() => {
        // Ignore tracking errors
      });
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

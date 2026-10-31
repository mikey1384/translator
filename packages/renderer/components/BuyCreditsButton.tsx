import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import * as SystemIPC from '@ipc/system';
import { CHECKOUT_ALREADY_PENDING } from '../../shared/constants';
import Button, { type ButtonSize, type ButtonVariant } from './Button';
import { useCreditStore } from '../state/credit-store';
import { openNotice } from '../state/modal-store';
import { showCheckoutFailedNotice } from '../utils/checkout-failure';

interface BuyCreditsButtonProps {
  packId: 'MICRO' | 'STARTER' | 'STANDARD' | 'PRO';
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  dataLog?: string;
  className?: string;
  placement?: CheckoutPlacement;
  onCheckoutCreated?: () => void;
}

type CheckoutPlacement =
  | 'zero-credit-banner'
  | 'credit-ran-out-dialog'
  | 'settings-credit-card'
  | 'free-preview-offer';

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
  const { loading, start: handleClick } = useCreditCheckout({
    packId,
    placement,
    onCheckoutCreated,
  });
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

/** Starts Stripe checkout for a pack, with the purchase funnel events. */
export function useCreditCheckout({
  packId,
  placement,
  onCheckoutCreated,
  trackShown = true,
}: {
  packId: BuyCreditsButtonProps['packId'];
  placement?: CheckoutPlacement;
  onCheckoutCreated?: () => void;
  // Off when a surface with several packs records one "shown" itself.
  trackShown?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  // Synchronous guard: two clicks before React re-renders must not start two
  // checkouts (main also refuses a second one while the first is created).
  const inFlight = useRef(false);

  useEffect(() => {
    if (!trackShown) return;
    // Track button shown once on mount
    void SystemIPC.trackPurchaseEvent('credit_checkout_button_shown', {
      packId,
      placement,
    }).catch(() => {
      // Ignore tracking errors
    });
  }, [packId, placement, trackShown]);

  async function handleClick(): Promise<void> {
    if (loading || inFlight.current) {
      return;
    }
    inFlight.current = true;
    let failed = false;

    // Track button press
    void SystemIPC.trackPurchaseEvent('credit_checkout_button_clicked', {
      packId,
      placement,
    }).catch(() => {
      // Ignore tracking errors
    });

    try {
      setLoading(true);
      // Marks this pack as the one being paid for right away; main's
      // pending/cancelled broadcasts confirm or clear it.
      useCreditStore.getState().noteCheckoutPack(packId);
      const checkoutSessionId = await SystemIPC.createCheckoutSession(
        packId,
        placement
      );
      if (checkoutSessionId === CHECKOUT_ALREADY_PENDING) {
        // This pack's checkout is already open (main reopens its Stripe
        // page) or another tab is creating one; the re-broadcast
        // pending/unresolved event marks the waiting pack — no error.
        // already_pending is not a failure, so we don't emit *_failed event
        onCheckoutCreated?.();
        return;
      }
      if (!checkoutSessionId) {
        // Session creation failed - track failure
        void SystemIPC.trackPurchaseEvent('credit_checkout_failed', {
          packId,
          placement,
          failureReason: 'api_error',
        }).catch(() => {
          // Ignore tracking errors
        });
        // No early return: the notice below runs after `finally`.
        failed = true;
      } else {
        onCheckoutCreated?.();
      }
    } catch (err: any) {
      console.error('Failed to start checkout:', err);
      // Track session creation failure
      const failureReason = String(err).includes('network')
        ? 'network_error'
        : 'api_error';
      void SystemIPC.trackPurchaseEvent('credit_checkout_failed', {
        packId,
        placement,
        failureReason,
      }).catch(() => {
        // Ignore tracking errors
      });
      failed = true;
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
    if (failed) {
      // Main gives up on the create request after a timeout, so this always
      // comes back: say what happened, offer a retry and a contact.
      const choice = await showCheckoutFailedNotice({
        t: i18n.t.bind(i18n),
        openNotice,
        openExternal: url => window.appShell.openExternal(url),
      });
      if (choice === 'retry') await handleClick();
    }
  }

  return { loading, start: handleClick };
}

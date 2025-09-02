import { useEffect } from 'react';
import { useCreditStore } from '../../../state';

export function useCreditSystem() {
  const { hours, loading: creditLoading, refresh } = useCreditStore();

  useEffect(() => {
    refresh();
  }, [refresh]);

  const showCreditWarning = (hours ?? 0) <= 0 && !creditLoading;
  const isButtonDisabled = false;

  return {
    balance: hours,
    creditLoading,
    showCreditWarning,
    isButtonDisabled,
    refreshCreditState: refresh,
  };
}

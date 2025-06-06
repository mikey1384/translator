import { useEffect } from 'react';
import { useCreditStore } from '../../../state';

export function useCreditSystem() {
  const { balance, loading: creditLoading, refresh } = useCreditStore();

  useEffect(() => {
    refresh();
  }, [refresh]);

  const showCreditWarning = (balance ?? 0) <= 0 && !creditLoading;
  const isButtonDisabled = (balance ?? 0) <= 0;

  return {
    balance,
    creditLoading,
    showCreditWarning,
    isButtonDisabled,
    refreshCreditState: refresh,
  };
}

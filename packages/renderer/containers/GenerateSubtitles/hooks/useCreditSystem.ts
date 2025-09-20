import { useEffect } from 'react';
import { useCreditStore } from '../../../state';
import { useAiStore } from '../../../state';

export function useCreditSystem() {
  const { hours, loading: creditLoading, refresh } = useCreditStore();
  const useByo = useAiStore(s => s.useByo);
  const byoUnlocked = useAiStore(s => s.byoUnlocked);
  const keyPresent = useAiStore(s => s.keyPresent);
  const keyValue = useAiStore(s => s.keyValue);
  const usingApiKey = Boolean(useByo && byoUnlocked && (keyPresent || (keyValue || '').trim()));

  useEffect(() => {
    refresh();
  }, [refresh]);

  const showCreditWarning = !usingApiKey && (hours ?? 0) <= 0 && !creditLoading;
  const isButtonDisabled = false;

  return {
    balance: hours,
    creditLoading,
    showCreditWarning,
    isButtonDisabled,
    refreshCreditState: refresh,
  };
}

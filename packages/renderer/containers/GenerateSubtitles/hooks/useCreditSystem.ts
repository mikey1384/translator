import { useState, useEffect } from 'react';
import { useCreditStore } from '../../../state';
import * as SystemIPC from '../../../ipc/system';

export function useCreditSystem() {
  const { balance, loading: creditLoading, refresh } = useCreditStore();
  const [hasOpenAI, setHasOpenAI] = useState<boolean>(false);

  useEffect(() => {
    refresh();
    SystemIPC.hasOpenAIKey().then(setHasOpenAI);
  }, [refresh]);

  const canBypassCredits = hasOpenAI;
  const showCreditWarning = (balance ?? 0) <= 0 && !creditLoading && !hasOpenAI;
  const isButtonDisabled = !hasOpenAI && (balance ?? 0) <= 0;

  return {
    balance,
    creditLoading,
    hasOpenAI,
    canBypassCredits,
    showCreditWarning,
    isButtonDisabled,
    refreshCreditState: refresh,
  };
}

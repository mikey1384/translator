import { useEffect } from 'react';
import { useCreditStore } from '../../../state';
import { useAiStore } from '../../../state';
import { hasStrictByoActiveCoverage } from '../../../state/byo-runtime';

export function useCreditSystem() {
  const hours = useCreditStore(s => s.hours);
  const creditLoading = useCreditStore(s => s.loading);
  const refresh = useCreditStore(s => s.refresh);
  const useStrictByoMode = useAiStore(s => s.useStrictByoMode);
  const byoUnlocked = useAiStore(s => s.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(s => s.byoAnthropicUnlocked);
  const byoElevenLabsUnlocked = useAiStore(s => s.byoElevenLabsUnlocked);
  const useByo = useAiStore(s => s.useByo);
  const keyPresent = useAiStore(s => s.keyPresent);
  const useByoAnthropic = useAiStore(s => s.useByoAnthropic);
  const anthropicKeyPresent = useAiStore(s => s.anthropicKeyPresent);
  const useByoElevenLabs = useAiStore(s => s.useByoElevenLabs);
  const elevenLabsKeyPresent = useAiStore(s => s.elevenLabsKeyPresent);
  const aiInitialized = useAiStore(s => s.initialized);
  const usingApiKey = hasStrictByoActiveCoverage({
    useStrictByoMode,
    byoUnlocked,
    byoAnthropicUnlocked,
    byoElevenLabsUnlocked,
    useByo,
    useByoAnthropic,
    useByoElevenLabs,
    keyPresent,
    anthropicKeyPresent,
    elevenLabsKeyPresent,
  });

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Avoid flashing the warning before BYO state is initialized
  const showCreditWarning =
    aiInitialized && !usingApiKey && (hours ?? 0) <= 0 && !creditLoading;
  const isButtonDisabled = false;

  return {
    balance: hours,
    creditLoading,
    showCreditWarning,
    isButtonDisabled,
    refreshCreditState: refresh,
  };
}

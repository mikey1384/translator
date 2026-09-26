import { useCreditStore } from '../../../state';
import { useAiStore } from '../../../state';
import { hasApiKeyModeActiveCoverage } from '../../../state/byo-runtime';

export function useCreditSystem() {
  const hours = useCreditStore(s => s.hours);
  const creditLoading = useCreditStore(s => s.loading);
  const credits = useCreditStore(s => s.credits);
  const onlyWelcomeCredits = useCreditStore(
    s => s.history?.onlyWelcomeCredits === true
  );
  const useApiKeysMode = useAiStore(s => s.useApiKeysMode);
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
  const usingApiKey = hasApiKeyModeActiveCoverage({
    useApiKeysMode,
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

  // Avoid flashing the warning before BYO state is initialized
  const showCreditWarning =
    aiInitialized &&
    !usingApiKey &&
    hours !== null &&
    hours <= 0 &&
    !creditLoading;
  // A device whose only credits are the welcome grant gets a friendly note
  // instead of silence; the component remembers once it was dismissed.
  const showWelcomeHint =
    aiInitialized &&
    !usingApiKey &&
    !creditLoading &&
    typeof credits === 'number' &&
    credits > 0 &&
    onlyWelcomeCredits;
  const isButtonDisabled = false;

  return {
    balance: hours,
    creditLoading,
    showCreditWarning,
    showWelcomeHint,
    isButtonDisabled,
  };
}

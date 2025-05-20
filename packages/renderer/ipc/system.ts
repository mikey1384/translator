import type {
  ApiKeyStatusResult,
  CreditBalanceResult,
  PurchaseCreditsOptions,
  PurchaseCreditsResult,
} from '@shared-types/app';

type ApiKeyType = 'openai';

export function showMessage(message: string): Promise<void> {
  return window.electron.showMessage(message);
}

export function getLocaleUrl(lang: string): Promise<string> {
  return window.electron.getLocaleUrl(lang);
}

export function getApiKeyStatus(): Promise<ApiKeyStatusResult> {
  return window.electron.getApiKeyStatus();
}

export function saveApiKey(
  keyType: ApiKeyType,
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.saveApiKey(keyType, apiKey);
}

export function getLanguagePreference(): Promise<string | null> {
  return window.electron.getLanguagePreference();
}

export function setLanguagePreference(
  lang: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setLanguagePreference(lang);
}

export function getCreditBalance(): Promise<CreditBalanceResult> {
  return window.electron.getCreditBalance();
}

export function purchaseCredits(
  opts: PurchaseCreditsOptions
): Promise<PurchaseCreditsResult> {
  return window.electron.purchaseCredits(opts);
}

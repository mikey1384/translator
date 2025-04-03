import { useState, useEffect, useCallback } from 'react';

// Define Key Status Type moved from App/index.tsx
export type ApiKeyStatus = {
  openai: boolean;
  anthropic: boolean;
} | null;

export function useApiKeyStatus() {
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>(null);
  const [isLoadingKeyStatus, setIsLoadingKeyStatus] = useState<boolean>(true);

  // --- Fetch API Key Status --- moved from App/index.tsx
  const fetchKeyStatus = useCallback(async () => {
    console.log('Attempting to fetch API key status...');
    setIsLoadingKeyStatus(true);
    try {
      const result = await window.electron.getApiKeyStatus();
      if (result.success) {
        console.log('API Key Status fetched:', result.status);
        setApiKeyStatus(result.status);
      } else {
        console.error('Failed to fetch key status:', result.error);
        setApiKeyStatus({ openai: false, anthropic: false }); // Assume none set on error
      }
    } catch (error) {
      console.error('Error calling getApiKeyStatus:', error);
      setApiKeyStatus({ openai: false, anthropic: false });
    } finally {
      setIsLoadingKeyStatus(false);
      console.log('Finished fetching API key status.');
    }
  }, []);

  // Fetch status on initial mount - moved from App/index.tsx
  useEffect(() => {
    fetchKeyStatus();
  }, [fetchKeyStatus]);

  return { apiKeyStatus, isLoadingKeyStatus, fetchKeyStatus };
}

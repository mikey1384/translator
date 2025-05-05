import { useState, useEffect, useCallback } from 'react';
import * as SystemIPC from '@ipc/system';

export type ApiKeyState =
  | { status: 'loading' }
  | { status: 'ready'; data: { openai: boolean } }
  | { status: 'error'; message: string };

export function useApiKeyStatus() {
  const [state, setState] = useState<ApiKeyState>({ status: 'loading' });

  const refetch = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('Attempting to fetch API key status...');
      }
      const result = await SystemIPC.getApiKeyStatus();
      if (result.success && result.status) {
        console.log('API Key Status fetched:', result.status);
        setState({ status: 'ready', data: result.status });
      } else {
        console.error('Failed to fetch key status:', result.error);
        throw new Error(result.error ?? 'Unknown error');
      }
    } catch (error: any) {
      console.error('Error calling getApiKeyStatus:', error);
      setState({ status: 'error', message: error.message ?? String(error) });
    } finally {
      if (process.env.NODE_ENV === 'development') {
        console.log('Finished fetching API key status.');
      }
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { state, refetch };
}

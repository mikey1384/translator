import { create } from 'zustand';
import * as SystemIPC from '@ipc/system';

interface SettingsState {
  loading: boolean;
  keySet: boolean | undefined;
  saveStatus: { ok: boolean; msg: string } | null;
  fetchStatus: () => Promise<void>;
  saveKey: (key: string) => Promise<void>;
  clearStatus: () => void;
}

export const useSettingsStore = create<SettingsState>(set => ({
  loading: true,
  keySet: undefined,
  saveStatus: null,
  fetchStatus: async () => {
    set({ loading: true });
    try {
      const res = await SystemIPC.getApiKeyStatus();
      set({ keySet: res.status?.openai || false, loading: false });
    } catch (e) {
      console.error('getApiKeyStatus failed', e);
      set({ keySet: false, loading: false });
    }
  },
  saveKey: async (key: string) => {
    set({ saveStatus: null });
    const res = await SystemIPC.saveApiKey('openai', key);
    set({
      keySet: !!key && res.success,
      saveStatus: {
        ok: res.success,
        msg: res.success ? 'Saved!' : res.error || 'Error',
      },
    });
  },
  clearStatus: () => set({ saveStatus: null }),
}));

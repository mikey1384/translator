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
      saveStatus: !res.success
        ? { ok: false, msg: res.error || 'Error' }
        : key
          ? { ok: true, msg: 'Saved!' }
          : null,
    });

    if (key) setTimeout(() => set({ saveStatus: null }), 3000);
  },
  clearStatus: () => set({ saveStatus: null }),
}));

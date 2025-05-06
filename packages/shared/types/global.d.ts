import type { IpcRenderer } from 'electron';
import type { ElectronAPI } from '@shared-types/app';

declare global {
  /* ───────── window helpers ───────────────────────────── */
  interface Window {
    electron: ElectronAPI;
    ipcRenderer: IpcRenderer;
  }

  /* ───────── hot-module-reloading typings ─────────────── */
  interface ImportMeta {
    readonly hot?: {
      accept(cb?: () => void): void;
      dispose(cb: () => void): void;
    };
  }

  interface NodeModule {
    hot?: {
      accept(cb?: () => void): void;
      dispose(cb: () => void): void;
    };
  }
}

export {};

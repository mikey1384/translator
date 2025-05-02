import type { IpcRenderer } from 'electron';
import type { ElectronAPI } from '@shared-types/app';

declare global {
  interface Window {
    electron: ElectronAPI;
    ipcRenderer: IpcRenderer;
  }
}

export {};

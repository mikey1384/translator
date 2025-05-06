import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Define the channel name (must match main process relay)
const WINDOW_CHANNELS = {
  UPDATE_SUBTITLE: 'render-window-update-subtitle',
};

console.log('[preload-render-window] Preload script started.');

// Securely expose specific IPC functionality to the hidden window's renderer process
try {
  contextBridge.exposeInMainWorld('renderHostBridge', {
    onUpdateSubtitle: (callback: (text: string) => void) => {
      const handler = (_event: IpcRendererEvent, args: { text: string }) => {
        const newText = args?.text ?? '';
        callback(newText);
      };

      console.log(
        `[preload-render-window] Adding listener for ${WINDOW_CHANNELS.UPDATE_SUBTITLE}`
      );
      // Register the listener with Electron's ipcRenderer
      ipcRenderer.on(WINDOW_CHANNELS.UPDATE_SUBTITLE, handler);

      // Return a cleanup function to remove the listener when the React component unmounts
      return () => {
        console.log(
          `[preload-render-window] Removing listener for ${WINDOW_CHANNELS.UPDATE_SUBTITLE}`
        );
        ipcRenderer.removeListener(WINDOW_CHANNELS.UPDATE_SUBTITLE, handler);
      };
    },
  });
  console.log(
    '[preload-render-window] contextBridge.exposeInMainWorld successful.'
  );
} catch (error) {
  console.error('[preload-render-window] Failed to expose bridge:', error);
}

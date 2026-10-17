// Preload for the tab-strip shell page. Exposes a minimal, shell-only API.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tabs', {
  create: () => ipcRenderer.send('tabs:create'),
  select: id => ipcRenderer.send('tabs:select', id),
  close: id => ipcRenderer.send('tabs:close', id),
  reorder: (id, index) => ipcRenderer.send('tabs:reorder', id, index),
  // Keyboard: which tab holds focus (Cmd/Ctrl+W closes it), and leaving
  // the strip for the page.
  focused: id => ipcRenderer.send('tabs:focused', id),
  focusApp: () => ipcRenderer.send('tabs:focus-app'),
  onFocusStrip: callback => {
    const listener = () => {
      try {
        callback();
      } catch (err) {
        console.error('[shell-preload] tabs:focus-strip callback failed:', err);
      }
    };
    ipcRenderer.on('tabs:focus-strip', listener);
    return () => ipcRenderer.removeListener('tabs:focus-strip', listener);
  },
  onI18n: callback => {
    const listener = (_event, strings) => {
      try {
        callback(strings);
      } catch (err) {
        console.error('[shell-preload] tabs:i18n callback failed:', err);
      }
    };
    ipcRenderer.on('tabs:i18n', listener);
    return () => ipcRenderer.removeListener('tabs:i18n', listener);
  },
  onState: callback => {
    const listener = (_event, state) => {
      try {
        callback(state);
      } catch (err) {
        console.error('[shell-preload] tabs:state callback failed:', err);
      }
    };
    ipcRenderer.on('tabs:state', listener);
    ipcRenderer.send('tabs:request-state');
    return () => ipcRenderer.removeListener('tabs:state', listener);
  },
});

// Minimal preload script
const { contextBridge, ipcRenderer } = require("electron");

console.log("Minimal preload script executing");

// Test if ipcRenderer exists and has invoke method
console.log("ipcRenderer exists:", !!ipcRenderer);
console.log("ipcRenderer.invoke exists:", !!ipcRenderer.invoke);

// Expose minimal API
contextBridge.exposeInMainWorld("electronAPI", {
  ping: () => {
    console.log("Ping function called from renderer");
    return ipcRenderer.invoke("ping");
  },
});

console.log("Minimal preload script completed");

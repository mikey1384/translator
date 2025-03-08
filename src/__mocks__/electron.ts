// Simple mock for Electron
export const app = {
  getPath: jest.fn((name) => `/mock/path/${name}`),
  whenReady: jest.fn(() => Promise.resolve()),
  on: jest.fn(),
  quit: jest.fn(),
};

export const BrowserWindow = function () {
  return {
    loadURL: jest.fn(),
    loadFile: jest.fn(),
    webContents: {
      openDevTools: jest.fn(),
    },
    on: jest.fn(),
    show: jest.fn(),
  };
};

// Static methods
BrowserWindow.getAllWindows = jest.fn(() => []);
BrowserWindow.getFocusedWindow = jest.fn(() => ({
  webContents: { send: jest.fn() },
}));

export const ipcMain = {
  handle: jest.fn(),
  on: jest.fn(),
};

export const ipcRenderer = {
  invoke: jest.fn(),
  on: jest.fn(),
  send: jest.fn(),
};

export const dialog = {
  showOpenDialog: jest.fn(() =>
    Promise.resolve({
      canceled: false,
      filePaths: ["/mock/path/file.mp4"],
    })
  ),
  showSaveDialog: jest.fn(() =>
    Promise.resolve({
      canceled: false,
      filePath: "/mock/path/output.srt",
    })
  ),
};

export const contextBridge = {
  exposeInMainWorld: jest.fn(),
};

// Mock Electron API for testing
import * as path from "path";
import { jest } from "@jest/globals";

// Define mock functions with proper types
type MockFn = jest.Mock<any, any>;

const app = {
  getPath: jest.fn((name: string) => {
    if (name === "userData") {
      return "/mock/path/userData";
    }
    return `/mock/path/${name}`;
  }) as MockFn,
  whenReady: jest.fn().mockResolvedValue(undefined) as MockFn,
  on: jest.fn() as MockFn,
  quit: jest.fn() as MockFn,
};

const BrowserWindowMock = jest.fn().mockImplementation(() => ({
  loadURL: jest.fn(),
  loadFile: jest.fn(),
  webContents: {
    openDevTools: jest.fn(),
  },
  on: jest.fn(),
  show: jest.fn(),
})) as MockFn;

// Add static methods to BrowserWindow mock
const BrowserWindow = Object.assign(BrowserWindowMock, {
  getAllWindows: jest.fn().mockReturnValue([]) as MockFn,
  getFocusedWindow: jest.fn().mockReturnValue({
    webContents: {
      send: jest.fn(),
    },
  }) as MockFn,
});

const ipcMain = {
  handle: jest.fn() as MockFn,
  on: jest.fn() as MockFn,
};

const ipcRenderer = {
  invoke: jest.fn() as MockFn,
  on: jest.fn() as MockFn,
  send: jest.fn() as MockFn,
};

const dialog = {
  showOpenDialog: jest
    .fn()
    .mockResolvedValue({
      canceled: false,
      filePaths: ["/mock/path/file.mp4"],
    }) as MockFn,
  showSaveDialog: jest
    .fn()
    .mockResolvedValue({
      canceled: false,
      filePath: "/mock/path/output.srt",
    }) as MockFn,
};

const contextBridge = {
  exposeInMainWorld: jest.fn() as MockFn,
};

export { app, BrowserWindow, ipcMain, ipcRenderer, dialog, contextBridge };

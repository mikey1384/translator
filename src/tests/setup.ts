import { jest } from "@jest/globals";

// Mock electron modules
jest.mock("electron", () => {
  return {
    app: {
      getPath: jest.fn((name) => `/mock/path/${name}`),
      whenReady: jest.fn().mockResolvedValue(undefined as any),
      on: jest.fn(),
      quit: jest.fn(),
    },
    BrowserWindow: Object.assign(
      jest.fn().mockImplementation(() => ({
        loadURL: jest.fn(),
        loadFile: jest.fn(),
        webContents: {
          openDevTools: jest.fn(),
        },
        on: jest.fn(),
        show: jest.fn(),
      })),
      {
        getAllWindows: jest.fn().mockReturnValue([]),
        getFocusedWindow: jest.fn().mockReturnValue({
          webContents: {
            send: jest.fn(),
          },
        } as any),
      }
    ),
    ipcMain: {
      handle: jest.fn(),
      on: jest.fn(),
    },
    ipcRenderer: {
      invoke: jest.fn(),
      on: jest.fn(),
      send: jest.fn(),
    },
    dialog: {
      showOpenDialog: jest.fn().mockResolvedValue({
        canceled: false,
        filePaths: ["/mock/path/file.mp4"],
      } as any),
      showSaveDialog: jest.fn().mockResolvedValue({
        canceled: false,
        filePath: "/mock/path/output.srt",
      } as any),
    },
    contextBridge: {
      exposeInMainWorld: jest.fn(),
    },
  };
});

// Mock electron-log
jest.mock("electron-log", () => ({
  initialize: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock ffmpeg modules
jest.mock("@ffmpeg-installer/ffmpeg", () => ({
  path: "/mock/path/to/ffmpeg",
}));

jest.mock("@ffprobe-installer/ffprobe", () => ({
  path: "/mock/path/to/ffprobe",
}));

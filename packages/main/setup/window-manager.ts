import {
  BrowserWindow,
  Menu,
  MenuItemConstructorOptions,
  app,
  dialog,
  ipcMain,
} from 'electron';
import path from 'path';
import log from 'electron-log';
import electronContextMenu from 'electron-context-menu';
import nodeProcess from 'process';
import { esmDirname } from '@shared/esm-paths';

const __dirname = esmDirname(import.meta.url);
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export async function createMainWindow(
  filePathToOpenOnLoad?: string | null
): Promise<void> {
  log.info('[window-manager] Creating main window...');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
      allowRunningInsecureContent: false,
      sandbox: false,
      preload: path.join(__dirname, '../preload/preload.cjs'),
      backgroundThrottling: false,
    },
  });

  electronContextMenu({
    window: mainWindow,
    showInspectElement: isDev,
  });

  const rendererPath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'packages',
    'renderer',
    'dist',
    'index.html'
  );

  log.info(`[window-manager] Loading renderer from: ${rendererPath}`);

  try {
    await mainWindow.loadFile(rendererPath);
    log.info('[window-manager] Renderer loaded successfully.');
  } catch (loadError: any) {
    log.error('[window-manager] Error loading renderer:', loadError);
    dialog.showErrorBox(
      'Load Error',
      `Failed to load UI: ${loadError.message}`
    );
    app.quit();
    return;
  }

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    log.info('[window-manager] Main window closed.');
    mainWindow = null;
  });

  setupFindInPageHandlers(mainWindow);
  setupFileLoadingHandler(mainWindow, filePathToOpenOnLoad);
  createApplicationMenu();
}

function setupFindInPageHandlers(window: BrowserWindow): void {
  let currentFindText = '';

  ipcMain.on(
    'find-in-page',
    (_event, { text, findNext, forward, matchCase }) => {
      if (!window) return;
      if (text && text.length > 0) {
        if (text !== currentFindText) currentFindText = text;
        window.webContents.findInPage(text, {
          findNext: !!findNext,
          forward: forward === undefined ? true : forward,
          matchCase: !!matchCase,
        });
      } else {
        window.webContents.stopFindInPage('clearSelection');
        currentFindText = '';
      }
    }
  );

  ipcMain.on('stop-find', () => {
    if (window) {
      window.webContents.stopFindInPage('clearSelection');
      currentFindText = '';
    }
  });

  window.webContents.on('found-in-page', (_event, result) => {
    window.webContents.send('find-results', {
      matches: result.matches,
      activeMatchOrdinal: result.activeMatchOrdinal,
      finalUpdate: result.finalUpdate,
    });
  });
}

function setupFileLoadingHandler(
  window: BrowserWindow,
  filePathToOpen?: string | null
): void {
  window.webContents.on('did-finish-load', () => {
    log.info('[window-manager] Main window finished loading content.');
    if (filePathToOpen) {
      log.info(
        `[window-manager] Processing queued file path: ${filePathToOpen}`
      );
      if (
        window &&
        !window.isDestroyed() &&
        window.webContents &&
        !window.webContents.isDestroyed()
      ) {
        window.webContents.send('open-video-file', filePathToOpen);
      } else {
        log.error(
          '[window-manager] Cannot send queued file: window became invalid.'
        );
      }
    }
  });
}

function createApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...((nodeProcess.platform === 'darwin'
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []) as MenuItemConstructorOptions[]),
    {
      label: 'File',
      submenu: [
        nodeProcess.platform === 'darwin'
          ? { role: 'close' }
          : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...((nodeProcess.platform === 'darwin'
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              {
                label: 'Speech',
                submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
              },
            ]
          : [
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' },
            ]) as MenuItemConstructorOptions[]),
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('show-find-bar'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...((isDev
          ? [{ role: 'toggleDevTools' }]
          : []) as MenuItemConstructorOptions[]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        ...((nodeProcess.platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front' }]
          : []) as MenuItemConstructorOptions[]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            const aboutMessage = `Translator Electron App\nVersion: ${app.getVersion()}`;
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About',
              message: aboutMessage,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

export function openVideoFile(filePath: string): void {
  log.info(`[window-manager] Attempting to open video file: ${filePath}`);

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('open-video-file', filePath);
      log.info(`[window-manager] Sent file to renderer: ${filePath}`);
    } else {
      log.error(
        '[window-manager] Window webContents are destroyed, cannot send file.'
      );
    }
  } else {
    log.error(
      '[window-manager] Main window is null or destroyed, cannot open file.'
    );
  }
}

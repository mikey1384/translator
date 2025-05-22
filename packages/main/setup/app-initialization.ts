import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import log from 'electron-log';
import nodeProcess from 'process';

let filePathToOpenOnLoad: string | null = null;

export function getFilePathToOpenOnLoad(): string | null {
  return filePathToOpenOnLoad;
}

export function setFilePathToOpenOnLoad(path: string | null): void {
  filePathToOpenOnLoad = path;
}

export function setupSingleInstance(
  openVideoFile: (filePath: string) => void
): void {
  if (!app.requestSingleInstanceLock()) {
    log.info('[app-init] Another instance detected. Quitting this instance.');
    app.quit();
    nodeProcess.exit(0);
  }

  // Handle primary instance launch with file argument
  const fileArgFromPrimaryInstance = nodeProcess.argv
    .slice(1)
    .find(
      p =>
        /\.\w+$/.test(p) &&
        !p.startsWith('--') &&
        fs.existsSync(p.replace(/^"|"$/g, ''))
    );

  if (fileArgFromPrimaryInstance) {
    log.info(
      `[app-init] Application launched with file argument (primary instance): ${fileArgFromPrimaryInstance}`
    );
    filePathToOpenOnLoad = fileArgFromPrimaryInstance.replace(/^"|"$/g, '');
  }

  // Handle second instance events
  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    log.info('[app-init] second-instance event triggered.');
    log.info(`[app-init] Command line: ${commandLine.join(' ')}`);

    const fileArg = commandLine
      .slice(1)
      .find(
        arg =>
          /\.\w+$/.test(arg) &&
          !arg.startsWith('--') &&
          fs.existsSync(arg.replace(/^"|"$/g, ''))
      );

    if (fileArg) {
      log.info(
        `[app-init] File path found in second-instance commandLine: ${fileArg}`
      );
      openVideoFile(fileArg.replace(/^"|"$/g, ''));
    } else {
      log.info(
        '[app-init] No specific file path found or file does not exist in second-instance commandLine. Focusing window.'
      );
    }

    // Focus existing window or create new one
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows[0];

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else if (fileArg) {
      // Will be handled by the main process to create window
      log.info(
        '[app-init] No window available, main process should create one'
      );
    }
  });
}

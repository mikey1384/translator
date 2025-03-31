const path = require('path');
const fs = require('fs');
const { ipcMain, app } = require('electron');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.info('Another instance is already running. Quitting...');
  app.quit();
  process.exit(0);
}

const logFile = path.join(__dirname, 'app.log');
const logStream = fs.createWriteStream(logFile, { flags: 'w' });

const startupMessage =
  '\n=== Application Started ' + new Date().toISOString() + ' ===\n\n';
logStream.write(startupMessage);

const originalConsole = { ...console };
function timestamp() {
  return new Date().toISOString();
}

console.log = (...args) => {
  const message = `[${timestamp()}] [LOG] ${args
    .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
    .join(' ')}\n`;
  logStream.write(message);
  originalConsole.log(...args);
};

console.info = (...args) => {
  const message = `[${timestamp()}] [INFO] ${args
    .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
    .join(' ')}\n`;
  logStream.write(message);
  originalConsole.info(...args);
};

console.warn = (...args) => {
  const message = `[${timestamp()}] [WARN] ${args
    .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
    .join(' ')}\n`;
  logStream.write(message);
  originalConsole.warn(...args);
};

console.error = (...args) => {
  const message = `[${timestamp()}] [ERROR] ${args
    .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
    .join(' ')}\n`;
  logStream.write(message);
  originalConsole.error(...args);
};

console.info('Loading application...');

function isHandlerRegistered(channel) {
  try {
    const tempHandler = () => {};
    ipcMain.handle(channel, tempHandler);
    ipcMain.removeHandler(channel);
    return false;
  } catch (error) {
    return true;
  }
}

let mainPath;

const distMainPath = path.join(__dirname, 'dist', 'main.js');
if (fs.existsSync(distMainPath)) {
  mainPath = distMainPath;
  console.info(`Found main module at ${mainPath}`);
} else {
  const potentialLocations = [
    path.join(__dirname, 'dist', 'main.js'),
    path.join(__dirname, 'main.js'),
    path.join(__dirname, 'dist', 'index.js'),
  ];

  for (const location of potentialLocations) {
    if (fs.existsSync(location)) {
      mainPath = location;
      console.info(`Found main module at ${mainPath}`);
      break;
    }
  }
}

if (!mainPath) {
  console.error('Could not find main module! Application cannot start.');
  process.exit(1);
}

if (!isHandlerRegistered('ping')) {
  console.info('Initializing handlers from main.cjs');
  try {
    require('./handlers/index');
    console.info('Handlers initialized successfully');
  } catch (err) {
    console.warn('Error initializing handlers:', err.message);
  }
} else {
  console.info(
    'Handlers already registered, skipping initialization from main.cjs'
  );
}

try {
  require(mainPath);
} catch (err) {
  console.error('Error loading main module:', err);
  process.exit(1);
}

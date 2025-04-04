const path = require('path');
const fs = require('fs');

function setupLogging() {
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

  console.info('Logging initialized.');
}

module.exports = { setupLogging };

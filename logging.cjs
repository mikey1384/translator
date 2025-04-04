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

  // Helper to format arguments, handling Errors
  function formatArgs(args) {
    return args
      .map(arg => {
        if (arg instanceof Error) {
          // Log error message and stack
          return `${arg.message}\nStack: ${arg.stack}`;
        } else if (typeof arg === 'object' && arg !== null) {
          // Attempt to stringify objects, handle potential circular references
          try {
            return JSON.stringify(arg);
          } catch (e) {
            return '[Unserializable Object]';
          }
        } else {
          // Convert other types to string
          return String(arg);
        }
      })
      .join(' ');
  }

  console.log = (...args) => {
    const message = `[${timestamp()}] [LOG] ${formatArgs(args)}\n`;
    logStream.write(message);
    originalConsole.log(...args);
  };

  console.info = (...args) => {
    const message = `[${timestamp()}] [INFO] ${formatArgs(args)}\n`;
    logStream.write(message);
    originalConsole.info(...args);
  };

  console.warn = (...args) => {
    const message = `[${timestamp()}] [WARN] ${formatArgs(args)}\n`;
    logStream.write(message);
    originalConsole.warn(...args);
  };

  console.error = (...args) => {
    const message = `[${timestamp()}] [ERROR] ${formatArgs(args)}\n`;
    logStream.write(message);
    originalConsole.error(...args);
  };

  console.info('Logging initialized.');
}

module.exports = { setupLogging };

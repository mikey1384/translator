// Debug startup script
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");

// Clear log file first
const logFile = path.join(__dirname, "startup-debug.log");
fs.writeFileSync(logFile, "=== DEBUG STARTUP LOG ===\n\n", "utf8");

// Log basic information
fs.appendFileSync(logFile, `Started at: ${new Date().toISOString()}\n`, "utf8");
fs.appendFileSync(logFile, `Current directory: ${process.cwd()}\n`, "utf8");
fs.appendFileSync(logFile, `Platform: ${os.platform()}\n`, "utf8");
fs.appendFileSync(logFile, `Node version: ${process.version}\n`, "utf8");

// Log directory content
fs.appendFileSync(logFile, "\n=== DIRECTORY CONTENT ===\n", "utf8");
try {
  const files = fs.readdirSync(__dirname);
  files.forEach((file) => {
    const stats = fs.statSync(path.join(__dirname, file));
    fs.appendFileSync(
      logFile,
      `${file} (${stats.isDirectory() ? "directory" : "file"}, size: ${
        stats.size
      } bytes)\n`,
      "utf8"
    );
  });
} catch (err) {
  fs.appendFileSync(
    logFile,
    `Error listing directory: ${err.message}\n`,
    "utf8"
  );
}

// Check if main.cjs exists
fs.appendFileSync(logFile, "\n=== MAIN FILE CHECK ===\n", "utf8");
const mainFile = path.join(__dirname, "main.cjs");
const mainExists = fs.existsSync(mainFile);
fs.appendFileSync(logFile, `main.cjs exists: ${mainExists}\n`, "utf8");

if (mainExists) {
  try {
    const mainContent = fs.readFileSync(mainFile, "utf8").slice(0, 500);
    fs.appendFileSync(
      logFile,
      `main.cjs first 500 chars:\n${mainContent}...\n`,
      "utf8"
    );
  } catch (err) {
    fs.appendFileSync(
      logFile,
      `Error reading main.cjs: ${err.message}\n`,
      "utf8"
    );
  }
}

// Check if save-handler.js exists
const saveHandlerFile = path.join(__dirname, "save-handler.js");
const saveHandlerExists = fs.existsSync(saveHandlerFile);
fs.appendFileSync(
  logFile,
  `save-handler.js exists: ${saveHandlerExists}\n`,
  "utf8"
);

if (saveHandlerExists) {
  try {
    const saveHandlerContent = fs
      .readFileSync(saveHandlerFile, "utf8")
      .slice(0, 500);
    fs.appendFileSync(
      logFile,
      `save-handler.js first 500 chars:\n${saveHandlerContent}...\n`,
      "utf8"
    );
  } catch (err) {
    fs.appendFileSync(
      logFile,
      `Error reading save-handler.js: ${err.message}\n`,
      "utf8"
    );
  }
}

// Launch electron with main.cjs and capture all output
fs.appendFileSync(logFile, "\n=== LAUNCHING ELECTRON ===\n", "utf8");

const electron = spawn("npx", ["electron", "main.cjs", "--no-sandbox"], {
  stdio: "pipe",
});

// Log the process ID
fs.appendFileSync(logFile, `Electron process ID: ${electron.pid}\n`, "utf8");

// Capture stdout
electron.stdout.on("data", (data) => {
  const output = data.toString();
  fs.appendFileSync(logFile, `[STDOUT] ${output}`, "utf8");
});

// Capture stderr
electron.stderr.on("data", (data) => {
  const output = data.toString();
  fs.appendFileSync(logFile, `[STDERR] ${output}`, "utf8");
});

// Handle process exit
electron.on("close", (code) => {
  const exitMessage = `\n=== ELECTRON PROCESS EXITED WITH CODE ${code} ===\n`;
  fs.appendFileSync(logFile, exitMessage, "utf8");
});

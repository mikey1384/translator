#!/usr/bin/env node

import { spawn } from 'child_process';
import { watch, existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Electron process reference
let electronProcess = null;

// Cooldown flags to prevent rapid-fire restarts
let restartCooldown = false;
let lastRestartTime = 0;
const COOLDOWN_PERIOD = 2000; // 2 seconds cooldown

// Kill the Electron process if it's running
function killElectron() {
  if (electronProcess && !electronProcess.killed) {
    console.log('🔄 Restarting Electron app...');
    electronProcess.kill();
    electronProcess = null;
  }
}

// Get package.json data using fs instead of require
function getPackageJson() {
  try {
    const packageJsonPath = join(process.cwd(), 'package.json');
    const packageJsonContent = readFileSync(packageJsonPath, 'utf8');
    return JSON.parse(packageJsonContent);
  } catch (error) {
    console.error('Error reading package.json:', error);
    return { main: 'dist/main/main/index.js' }; // Default fallback
  }
}

// Helper function to find the electron executable
function findElectronExecutable() {
  const possiblePaths = [
    // Local node_modules path on UNIX-like systems
    join(process.cwd(), 'node_modules', '.bin', 'electron'),
    // Local node_modules path on Windows
    join(process.cwd(), 'node_modules', '.bin', 'electron.cmd'),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return { command: path, args: ['.'] };
    }
  }

  // If no direct path is found, fall back to npx which should find electron
  console.log('⚠️ Using npx fallback to find electron');
  return { command: 'npx', args: ['electron', '.'] };
}

// Start Electron
function startElectron() {
  // Prevent multiple restarts in quick succession
  const now = Date.now();
  if (restartCooldown || now - lastRestartTime < COOLDOWN_PERIOD) {
    console.log('⏳ Restart request during cooldown period, ignoring...');
    return;
  }

  restartCooldown = true;
  lastRestartTime = now;

  console.log('🚀 Starting Electron app...');
  console.log('📁 Current directory:', process.cwd());

  // Use the fs-based function instead of require
  const packageJson = getPackageJson();
  const mainPath = packageJson.main;
  console.log('📄 Main entry point:', mainPath);

  // Check if the main file exists
  if (existsSync(mainPath)) {
    console.log(`✅ Found main file: ${mainPath}`);
  } else {
    console.error(`❌ Main file not found: ${mainPath}`);
    restartCooldown = false;
    return;
  }

  // Check if the preload file exists
  const preloadPath = 'dist/preload/index.js';
  if (existsSync(preloadPath)) {
    console.log(`✅ Found preload file: ${preloadPath}`);
  } else {
    console.error(`❌ Preload file not found: ${preloadPath}`);
    restartCooldown = false;
    return;
  }

  // Find the electron executable path
  const electron = findElectronExecutable();
  console.log(
    `✅ Using electron command: ${
      electron.command
    } with args: ${electron.args.join(' ')}`
  );

  // Use spawn to start Electron with the full path
  electronProcess = spawn(electron.command, electron.args, {
    stdio: 'inherit',
    shell: process.platform === 'win32', // Use shell on Windows to find executables
  });

  electronProcess.on('close', code => {
    if (code !== 0 && code !== null) {
      console.error(`Electron process exited with code ${code}`);
    }
  });

  // Release cooldown after a delay
  setTimeout(() => {
    restartCooldown = false;
  }, COOLDOWN_PERIOD);
}

// Watch for changes in the dist directory
function watchDist() {
  const distDir = join(process.cwd(), 'dist');
  console.log(`👀 Watching for changes in ${distDir}...`);

  // Keep track of last file change time to prevent duplicate events
  let lastChangeTime = Date.now();
  const MIN_CHANGE_INTERVAL = 500; // minimum ms between change events

  // List of files that should trigger a restart
  const RESTART_PATTERNS = [
    /^main\/main\/index\.js$/, // Main process
    /^preload\/index\.js$/, // Preload script
    /^electron\/.*\.js$/, // Electron-specific modules
    /^api\/.*\.js$/, // API modules
  ];

  // Track which processes have started to prevent duplicate spawns
  let isWatching = false;

  watch(distDir, { recursive: true }, (eventType, filename) => {
    if (!filename || isWatching) return;

    const now = Date.now();
    if (now - lastChangeTime < MIN_CHANGE_INTERVAL) {
      return; // Ignore rapid changes
    }

    // Check if this file should trigger a restart
    const shouldRestart = RESTART_PATTERNS.some(pattern =>
      pattern.test(filename)
    );

    if (shouldRestart) {
      console.log(`📄 File changed: ${filename}`);
      lastChangeTime = now;

      // Use a debounce approach to avoid multiple restarts
      if (!restartCooldown) {
        killElectron();
        setTimeout(startElectron, 500);
      } else {
        console.log('⏳ Cooldown active, ignoring restart request');
      }
    }
  });
}

// Run the TSC compiler in watch mode for main process
function watchMainProcess() {
  console.log(
    '🔄 Starting TypeScript compiler for main process in watch mode...'
  );

  const tsc = spawn(
    'npx',
    ['tsc', '-p', 'tsconfig.base.json', '--watch', '--preserveWatchOutput'],
    {
      stdio: 'inherit',
      shell: true,
    }
  );

  tsc.on('close', code => {
    if (code !== 0 && code !== null) {
      console.error(`TypeScript compiler exited with code ${code}`);
    }
  });
}

// Run the bun build for renderer in watch mode
function watchRendererProcess() {
  console.log('🔄 Starting Bun bundler for renderer in watch mode...');

  const bun = spawn(
    'bun',
    [
      'build',
      './src/renderer/index.tsx',
      '--outdir',
      './dist/renderer',
      '--target',
      'browser',
      '--format',
      'esm', // Change from cjs to esm
      '--no-typecheck',
      '--watch',
    ],
    {
      stdio: 'inherit',
      shell: true,
    }
  );

  bun.on('close', code => {
    if (code !== 0 && code !== null) {
      console.error(`Bun bundler exited with code ${code}`);
    }
  });
}

// Run the bun build for preload in watch mode
function watchPreloadProcess() {
  console.log('🔄 Starting Bun bundler for preload in watch mode...');

  const bun = spawn(
    'bun',
    [
      'build',
      './packages/preload/preload.ts',
      '--outdir',
      './dist/preload',
      '--target',
      'node',
      '--no-typecheck',
      '--watch',
    ],
    {
      stdio: 'inherit',
      shell: true,
    }
  );

  bun.on('close', code => {
    if (code !== 0 && code !== null) {
      console.error(`Bun bundler exited with code ${code}`);
    }
  });
}

// Start the watchers and Electron
function start() {
  // Serialize the startup process to avoid race conditions
  watchMainProcess();

  setTimeout(() => {
    watchPreloadProcess();

    setTimeout(() => {
      watchRendererProcess();

      // Wait longer for initial compilation before starting Electron and watchers
      setTimeout(() => {
        watchDist();
        startElectron();
      }, 3000);
    }, 1000);
  }, 1000);

  // Handle process termination
  process.on('SIGINT', () => {
    killElectron();
    process.exit(0);
  });
}

// Run the start function
start();

#!/usr/bin/env node
/**
 * Minimal MCP helper for packaged Translator.app
 * 
 * Connects to running Translator's agent socket (not Playwright/repo).
 * Reads socket path from app's userData/agent/socket-path.txt.
 * 
 * Prerequisites:
 * 1. Launch Translator.app
 * 2. Settings → Agent Control → Enable
 * 3. Configure allowed directories
 * 
 * Usage (Cursor/Codex MCP config):
 *   macOS: /Applications/Translator.app/Contents/Resources/packaged-helper.mjs
 *   Windows: C:\Program Files\Translator\resources\packaged-helper.mjs
 */

import { createConnection } from 'net';
import { homedir, platform } from 'os';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';

// Get socket path from installed app's userData
function getSocketPath() {
  let userDataPath;
  
  if (platform() === 'darwin') {
    userDataPath = join(homedir(), 'Library', 'Application Support', 'Translator');
  } else if (platform() === 'win32') {
    userDataPath = join(process.env.APPDATA || '', 'Translator');
  } else if (platform() === 'linux') {
    userDataPath = join(homedir(), '.config', 'Translator');
  } else {
    throw new Error(`Unsupported platform: ${platform()}`);
  }
  
  // Read socket path from app-written file
  const socketInfoPath = join(userDataPath, 'agent', 'socket-path.txt');
  
  if (!existsSync(socketInfoPath)) {
    throw new Error(
      `Socket path file not found: ${socketInfoPath}\n\n` +
      `Make sure Translator is running and Agent Control is enabled in Settings.`
    );
  }
  
  const socketPath = readFileSync(socketInfoPath, 'utf8').trim();
  if (!socketPath) {
    throw new Error('Socket path file is empty');
  }
  
  return socketPath;
}

// Connect to Translator's agent socket
function connectToTranslator() {
  return new Promise((resolve, reject) => {
    const socketPath = getSocketPath();
    console.error(`[packaged-helper] Connecting to ${socketPath}...`);
    
    const socket = createConnection(socketPath);
    
    socket.on('connect', () => {
      console.error('[packaged-helper] Connected to Translator');
      resolve(socket);
    });
    
    socket.on('error', (err) => {
      reject(new Error(
        `Failed to connect to Translator: ${err.message}\n\n` +
        `Make sure Translator is running and Agent Control is enabled in Settings → Agent Control.`
      ));
    });
  });
}

// Forward stdin/stdout as JSON-RPC over socket
async function main() {
  let socket;
  
  try {
    socket = await connectToTranslator();
  } catch (err) {
    console.error(`[packaged-helper] ${err.message}`);
    process.exit(1);
  }
  
  // Forward stdin to socket
  process.stdin.on('data', (data) => {
    socket.write(data);
  });
  
  // Forward socket to stdout
  socket.on('data', (data) => {
    process.stdout.write(data);
  });
  
  socket.on('end', () => {
    console.error('[packaged-helper] Connection closed');
    process.exit(0);
  });
  
  socket.on('error', (err) => {
    console.error(`[packaged-helper] Socket error: ${err.message}`);
    process.exit(1);
  });
  
  process.on('SIGINT', () => {
    if (socket) socket.end();
    process.exit(0);
  });
}

main();

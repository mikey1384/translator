#!/usr/bin/env node
/**
 * Packaged MCP stdio forwarder for installed Translator.app
 * 
 * Pure Node.js script with ZERO external dependencies.
 * Connects to the running Translator's agent socket server and
 * transparently forwards stdin/stdout JSON-RPC traffic.
 * 
 * Prerequisites:
 *   1. Launch Translator.app
 *   2. Go to Settings → Agent Control
 *   3. Enable "Allow agent control"
 *   4. Configure allowed directories for file writes
 * 
 * Usage:
 *   node packaged-mcp.mjs
 * 
 * Add to Cursor/Codex MCP config:
 *   [macOS]
 *   /Applications/Translator.app/Contents/Resources/packaged-mcp.mjs
 *   
 *   [Windows] 
 *   C:\Program Files\Translator\resources\packaged-mcp.mjs
 * 
 * Security:
 *   - Requires explicit user permission in Translator Settings
 *   - Agent control can be disabled at any time (kill switch)
 *   - File writes are restricted to allowed directories only
 *   - Payment/checkout, secret writes, and admin resets are human-gated
 */

import { createConnection } from 'net';
import { homedir, platform } from 'os';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

let socket = null;

// Determine socket path by reading from Translator's userData
function getSocketPath() {
  // Compute userData path matching app.getPath('userData')
  // productName: Translator, appId: tools.stage5.translator
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
  
  // Read socket path from file written by AgentSocketServer
  const socketInfoPath = join(userDataPath, 'agent', 'socket-path.txt');
  
  try {
    if (existsSync(socketInfoPath)) {
      const socketPath = readFileSync(socketInfoPath, 'utf8').trim();
      if (socketPath) {
        return socketPath;
      }
    }
  } catch (err) {
    // Fall through to default path computation
  }
  
  // Fallback: compute expected socket path
  if (platform() === 'win32') {
    // Windows: per-user named pipe
    const sanitized = userDataPath.replace(/[^a-zA-Z0-9]/g, '_');
    return `\\\\.\\pipe\\translator-agent-${sanitized}`;
  } else {
    // Unix socket
    return join(userDataPath, 'agent', 'translator-agent.sock');
  }
}

async function connectToTranslator() {
  const socketPath = getSocketPath();
  
  return new Promise((resolve, reject) => {
    socket = createConnection(socketPath);
    
    socket.on('connect', () => {
      console.error(`[packaged-mcp] Connected to Translator at ${socketPath}`);
      resolve();
    });
    
    socket.on('error', (err) => {
      console.error('[packaged-mcp] Socket error:', err.message);
      console.error('');
      console.error('Make sure:');
      console.error('  1. Translator.app is running');
      console.error('  2. Agent control is enabled in Settings → Agent Control');
      console.error('  3. At least one allowed directory is configured');
      reject(err);
    });
    
    socket.on('end', () => {
      console.error('[packaged-mcp] Connection closed');
      process.exit(0);
    });
  });
}

async function main() {
  try {
    await connectToTranslator();
    
    // Forward stdin to socket (line-buffered JSON-RPC)
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
    
    rl.on('line', (line) => {
      if (socket && !socket.destroyed) {
        socket.write(line + '\n');
      }
    });
    
    // Forward socket responses to stdout
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim()) {
          process.stdout.write(line + '\n');
        }
      }
    });
    
    console.error('[packaged-mcp] Ready - forwarding stdio to Translator');
  } catch (err) {
    console.error('[packaged-mcp] Failed to start:', err.message);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  if (socket) socket.end();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (socket) socket.end();
  process.exit(0);
});

main();

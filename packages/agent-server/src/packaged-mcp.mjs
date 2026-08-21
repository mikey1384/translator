#!/usr/bin/env node
/**
 * Packaged MCP server for installed Translator.app
 * 
 * Minimal MCP stdio server (no npm dependencies) that forwards tool calls
 * to the running Translator's agent socket server.
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
 *   "C:\Program Files\Translator\resources\packaged-mcp.mjs"
 * 
 * Security:
 *   - Requires explicit user permission in Translator Settings
 *   - Agent control can be disabled at any time (kill switch)
 *   - File writes are restricted to allowed directories only
 *   - Payment/checkout, secret writes stay human-gated (NOT in tool list)
 */

import { createConnection } from 'net';
import { homedir, platform } from 'os';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

let socket = null;
let requestId = 0;
const pendingRequests = new Map();

// Safe app tools (excludes human-gated operations)
const APP_TOOLS = [
  { name: 'app_status', description: 'Get current app state' },
  { name: 'app_navigation_list', description: 'List navigation history' },
  { name: 'app_navigate', description: 'Navigate to a section' },
  { name: 'app_open_web_page', description: 'Open external web page' },
  { name: 'app_settings_show', description: 'Show settings UI' },
  { name: 'app_settings_get', description: 'Get current settings' },
  { name: 'app_open_video', description: 'Open video file or URL' },
  { name: 'app_mount_subtitles', description: 'Mount subtitle file' },
  { name: 'app_set_subtitle_display', description: 'Set subtitle display mode' },
  { name: 'app_set_subtitle_style', description: 'Set subtitle style' },
  { name: 'app_downloads_list', description: 'List download history' },
  { name: 'app_downloads_open', description: 'Open downloaded file' },
  { name: 'app_downloads_redownload', description: 'Redownload from URL' },
  { name: 'app_video_search', description: 'Search videos' },
  { name: 'app_video_search_more', description: 'Load more search results' },
  { name: 'app_video_search_status', description: 'Get search status' },
  { name: 'app_video_search_cancel', description: 'Cancel search' },
  { name: 'app_video_batch_download', description: 'Batch download videos' },
  { name: 'app_video_batch_cancel', description: 'Cancel batch download' },
  { name: 'app_video_batch_status', description: 'Get batch status' },
  { name: 'app_start_video_download', description: 'Download video' },
  { name: 'app_start_transcription', description: 'Transcribe audio' },
  { name: 'app_start_translation', description: 'Translate subtitles' },
  { name: 'app_start_dubbing', description: 'Generate dubbed audio' },
  { name: 'app_start_summary', description: 'Generate video summary' },
  { name: 'app_start_cue_translation', description: 'Translate single cue' },
  { name: 'app_start_cue_transcription', description: 'Transcribe single cue' },
  { name: 'app_start_merge', description: 'Merge subtitles with video' },
  { name: 'app_start_media_workflow', description: 'Run full media workflow' },
  { name: 'app_processing_status', description: 'Get processing status' },
  { name: 'app_processing_cancel', description: 'Cancel processing' },
  { name: 'app_subtitles_get', description: 'Get subtitle batch' },
  { name: 'app_subtitles_update', description: 'Update subtitles' },
  { name: 'app_subtitles_mutate', description: 'Mutate subtitle' },
  { name: 'app_subtitles_export', description: 'Export subtitles to file' },
];

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
    
    let buffer = '';
    
    socket.on('connect', () => {
      console.error(`[packaged-mcp] Connected to Translator at ${socketPath}`);
      resolve();
    });
    
    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          if (response.id && pendingRequests.has(response.id)) {
            const { resolve, reject } = pendingRequests.get(response.id);
            pendingRequests.delete(response.id);
            if (response.error) {
              reject(new Error(response.error.message || JSON.stringify(response.error)));
            } else {
              resolve(response.result);
            }
          }
        } catch (err) {
          console.error('[packaged-mcp] Failed to parse socket response:', err);
        }
      }
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

async function callTranslatorMethod(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Timeout calling ${method}`));
    }, 120000);
    
    pendingRequests.set(id, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      }
    });
    
    const request = {
      jsonrpc: '2.0',
      method,
      params,
      id
    };
    
    socket.write(JSON.stringify(request) + '\n');
  });
}

// MCP protocol handler
async function handleMcpRequest(request) {
  const { method, params, id } = request;
  
  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'translator-packaged-mcp',
            version: '1.0.0'
          }
        }
      };
    }
    
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: APP_TOOLS.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: true
            }
          }))
        }
      };
    }
    
    if (method === 'tools/call') {
      const { name: toolName, arguments: toolArgs } = params;
      
      // Convert app_* MCP tool name to translator method
      // app_start_merge -> startMerge (translator expects camelCase)
      let translatorMethod = toolName.replace(/^app_/, '');
      translatorMethod = translatorMethod.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      
      const result = await callTranslatorMethod(translatorMethod, toolArgs || {});
      
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }
          ]
        }
      };
    }
    
    throw new Error(`Unknown method: ${method}`);
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: error.message || String(error)
      }
    };
  }
}

async function main() {
  try {
    await connectToTranslator();
    
    // Handle MCP stdio protocol
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
    
    rl.on('line', async (line) => {
      if (!line.trim()) return;
      
      try {
        const request = JSON.parse(line);
        const response = await handleMcpRequest(request);
        process.stdout.write(JSON.stringify(response) + '\n');
      } catch (err) {
        console.error('[packaged-mcp] Error handling request:', err);
        const errorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error'
          }
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    });
    
    console.error('[packaged-mcp] MCP server ready');
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

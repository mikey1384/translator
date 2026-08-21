#!/usr/bin/env node
/**
 * Packaged MCP server for installed Translator.app
 * 
 * Implements MCP stdio protocol with Content-Length framing.
 * Zero npm dependencies.
 * 
 * Prerequisites:
 *   1. Launch Translator.app
 *   2. Go to Settings → Agent Control
 *   3. Enable "Allow agent control"
 *   4. Configure allowed directories for file writes
 * 
 * Add to Cursor/Codex MCP config:
 *   [macOS] /Applications/Translator.app/Contents/Resources/packaged-mcp.mjs
 *   [Windows] "C:\Program Files\Translator\resources\packaged-mcp.mjs"
 */

import { createConnection } from 'net';
import { homedir, platform } from 'os';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';

let socket = null;
let requestId = 0;
const pendingRequests = new Map();

// Explicit tool name → translator method map (from mcp.mjs)
const TOOL_MAP = {
  app_status: 'status',
  app_navigation_list: 'navigationSnapshot',
  app_navigate: 'navigate',
  app_open_web_page: 'openExternalWebPage',
  app_settings_show: 'showSettings',
  app_settings_get: 'settingsSnapshot',
  app_open_video: 'openVideo',
  app_mount_subtitles: 'mountSubtitles',
  app_set_subtitle_display: 'setDisplayMode',
  app_set_subtitle_style: 'setSubtitleStyle',
  app_show_download_history: 'showDownloadHistory',
  app_downloads_list: 'listDownloadHistory',
  app_downloads_open: 'openDownloadHistoryItem',
  app_downloads_redownload: 'redownloadHistoryItem',
  app_video_search: 'searchVideos',
  app_video_search_more: 'searchMoreVideos',
  app_video_search_status: 'videoSearchStatus',
  app_video_search_cancel: 'cancelVideoSearch',
  app_video_batch_download: 'startSuggestedVideoBatch',
  app_video_batch_cancel: 'cancelSuggestedVideoBatch',
  app_video_batch_status: 'suggestedVideoBatchStatus',
  app_start_video_download: 'startVideoDownload',
  app_start_transcription: 'startTranscription',
  app_start_translation: 'startTranslation',
  app_start_dubbing: 'startDubbing',
  app_start_summary: 'startSummary',
  app_start_cue_translation: 'startCueTranslation',
  app_start_cue_transcription: 'startCueTranscription',
  app_start_merge: 'startMerge',
  app_start_media_workflow: 'startMediaWorkflow',
  app_processing_status: 'processingStatus',
  app_processing_cancel: 'cancelProcessing',
  app_subtitles_get: 'subtitlesBatch',
  app_subtitles_update: 'updateSubtitles',
  app_subtitles_mutate: 'mutateSubtitles',
  app_subtitles_export: 'exportSubtitles',
};

// Safe tools list (excludes checkout/keys)
const SAFE_TOOLS = Object.keys(TOOL_MAP);

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
  
  const socketInfoPath = join(userDataPath, 'agent', 'socket-path.txt');
  try {
    if (existsSync(socketInfoPath)) {
      const socketPath = readFileSync(socketInfoPath, 'utf8').trim();
      if (socketPath) return socketPath;
    }
  } catch (err) {}
  
  if (platform() === 'win32') {
    const sanitized = userDataPath.replace(/[^a-zA-Z0-9]/g, '_');
    return `\\\\.\\pipe\\translator-agent-${sanitized}`;
  } else {
    return join(userDataPath, 'agent', 'translator-agent.sock');
  }
}

async function connectToTranslator() {
  const socketPath = getSocketPath();
  
  return new Promise((resolve, reject) => {
    socket = createConnection(socketPath);
    
    let buffer = '';
    
    socket.on('connect', () => {
      console.error(`[packaged-mcp] Connected to ${socketPath}`);
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
        } catch (err) {}
      }
    });
    
    socket.on('error', (err) => {
      console.error('[packaged-mcp] Socket error:', err.message);
      console.error('Make sure Translator.app is running with agent control enabled');
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
    
    socket.write(JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n');
  });
}

// Field mapping: snake_case → camelCase (from mcp.mjs)
function mapFields(input) {
  if (!input || typeof input !== 'object') return input;
  
  const mapped = {};
  for (const [key, value] of Object.entries(input)) {
    // Special mappings
    if (key === 'confirm_overwrite' && value === 'OVERWRITE') {
      mapped.overwrite = true;
    } else if (key === 'output_path') {
      mapped.outputPath = value;
    } else if (key === 'target_language') {
      mapped.targetLanguage = value;
    } else if (key === 'replace_subtitles') {
      mapped.replaceSubtitles = value;
    } else {
      // Generic snake_to_camel
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      mapped[camelKey] = value;
    }
  }
  return mapped;
}

// Content-Length framing (official MCP stdio protocol)
let stdinBuffer = '';
let expectedLength = null;

function writeMessage(msg) {
  const json = JSON.stringify(msg);
  const content = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
  process.stdout.write(content);
}

function readContentLengthMessage(data) {
  stdinBuffer += data;
  
  while (true) {
    if (expectedLength === null) {
      const headerEnd = stdinBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      
      const header = stdinBuffer.substring(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        console.error('[packaged-mcp] Invalid Content-Length header');
        stdinBuffer = stdinBuffer.substring(headerEnd + 4);
        continue;
      }
      
      expectedLength = parseInt(match[1], 10);
      stdinBuffer = stdinBuffer.substring(headerEnd + 4);
    }
    
    if (stdinBuffer.length >= expectedLength) {
      const message = stdinBuffer.substring(0, expectedLength);
      stdinBuffer = stdinBuffer.substring(expectedLength);
      expectedLength = null;
      
      try {
        const msg = JSON.parse(message);
        handleMessage(msg);
      } catch (err) {
        console.error('[packaged-mcp] Parse error:', err);
      }
    } else {
      return;
    }
  }
}

async function handleMessage(msg) {
  const { method, params, id } = msg;
  
  // Ignore notifications (no id)
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized') {
      console.error('[packaged-mcp] Client initialized');
    }
    return;
  }
  
  try {
    if (method === 'initialize') {
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'translator-packaged-mcp', version: '1.0.0' }
        }
      });
      return;
    }
    
    if (method === 'ping') {
      writeMessage({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    
    if (method === 'tools/list') {
      const tools = SAFE_TOOLS.map(name => ({
        name,
        description: `Translator: ${TOOL_MAP[name]}`,
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: true
        }
      }));
      writeMessage({ jsonrpc: '2.0', id, result: { tools } });
      return;
    }
    
    if (method === 'tools/call') {
      const { name: toolName, arguments: toolArgs } = params;
      
      if (!TOOL_MAP[toolName]) {
        throw new Error(`Unknown tool: ${toolName}`);
      }
      
      const translatorMethod = TOOL_MAP[toolName];
      const mappedArgs = mapFields(toolArgs || {});
      
      const result = await callTranslatorMethod(translatorMethod, mappedArgs);
      
      writeMessage({
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
      });
      return;
    }
    
    throw new Error(`Unknown method: ${method}`);
  } catch (error) {
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: error.message || String(error)
      }
    });
  }
}

async function main() {
  try {
    await connectToTranslator();
    
    process.stdin.on('data', (chunk) => {
      readContentLengthMessage(chunk.toString('utf8'));
    });
    
    console.error('[packaged-mcp] MCP server ready (Content-Length protocol)');
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

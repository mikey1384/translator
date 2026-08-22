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

// JSON Schemas for each tool (hand-written from mcp.mjs, zero npm deps)
const TOOL_SCHEMAS = {
  app_status: { 
    type: 'object', 
    properties: {
      history_id: { type: 'string', minLength: 1 }
    },
    additionalProperties: false 
  },
  app_navigation_list: { type: 'object', properties: {}, additionalProperties: false },
  app_navigate: {
    type: 'object',
    properties: {
      screen: { type: 'string', enum: ['generate', 'edit', 'settings', 'library'] }
    },
    required: ['screen'],
    additionalProperties: false
  },
  app_open_web_page: {
    type: 'object',
    properties: { url: { type: 'string', format: 'uri' } },
    required: ['url'],
    additionalProperties: false
  },
  app_settings_show: { type: 'object', properties: {}, additionalProperties: false },
  app_settings_get: { type: 'object', properties: {}, additionalProperties: false },
  app_credits_balance: { type: 'object', properties: {}, additionalProperties: false },
  app_mount_video_file: {
    type: 'object',
    properties: { path: { type: 'string', minLength: 1 } },
    required: ['path'],
    additionalProperties: false
  },
  app_mount_subtitle_file: {
    type: 'object',
    properties: { path: { type: 'string', minLength: 1 } },
    required: ['path'],
    additionalProperties: false
  },
  app_mount_url: {
    type: 'object',
    properties: { url: { type: 'string', format: 'uri' } },
    required: ['url'],
    additionalProperties: false
  },
  app_close_mounted_video: { type: 'object', properties: {}, additionalProperties: false },
  app_close_mounted_subtitles: { type: 'object', properties: {}, additionalProperties: false },
  app_library_downloads_list: { type: 'object', properties: {}, additionalProperties: false },
  app_library_history_item_open: {
    type: 'object',
    properties: { id: { type: 'string', minLength: 1 } },
    required: ['id'],
    additionalProperties: false
  },
  app_library_history_item_redownload: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      quality: {
        type: 'string',
        enum: ['high', 'mid', 'low', '4320p', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'],
        default: '1080p'
      },
      replace_subtitles: { type: 'string', enum: ['fail', 'discard', 'save'], default: 'fail' }
    },
    required: ['id'],
    additionalProperties: false
  },
  app_video_search: {
    type: 'object',
    properties: {
      prompt: { type: 'string', minLength: 1, maxLength: 2000 },
      preferred_language: { type: 'string', minLength: 2, maxLength: 24 },
      target_country: { type: 'string', maxLength: 100 },
      recency: { type: 'string', enum: ['any', 'day', 'week', 'month', 'year'] },
      include_download_history: { type: 'boolean' },
      include_watched_channels: { type: 'boolean' }
    },
    required: ['prompt'],
    additionalProperties: false
  },
  app_video_batch_download: {
    type: 'object',
    properties: {
      result_ids: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 8 },
      quality: {
        type: 'string',
        enum: ['high', 'mid', 'low', '4320p', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'],
        default: '1080p'
      }
    },
    required: ['result_ids'],
    additionalProperties: false
  },
  app_video_batch_cancel: { type: 'object', properties: {}, additionalProperties: false },
  app_video_batch_status: { type: 'object', properties: {}, additionalProperties: false },
  app_start_video_download: {
    type: 'object',
    properties: {
      url: { type: 'string', format: 'uri' },
      quality: {
        type: 'string',
        enum: ['high', 'mid', 'low', '4320p', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'],
        default: '1080p'
      },
      replace_subtitles: { type: 'string', enum: ['fail', 'discard', 'save'], default: 'fail' }
    },
    required: ['url'],
    additionalProperties: false
  },
  app_start_transcription: {
    type: 'object',
    properties: {
      replace_subtitles: { type: 'string', enum: ['fail', 'discard', 'save'], default: 'fail' },
      history_id: { type: 'string', minLength: 1 }
    },
    additionalProperties: false
  },
  app_start_translation: {
    type: 'object',
    properties: {
      target_language: { type: 'string', minLength: 2, maxLength: 80 },
      history_id: { type: 'string', minLength: 1 }
    },
    required: ['target_language'],
    additionalProperties: false
  },
  app_start_dubbing: {
    type: 'object',
    properties: {
      target_language: { type: 'string', minLength: 2, maxLength: 80 },
      voice: {
        type: 'string',
        enum: ['rachel', 'adam', 'josh', 'sarah', 'charlie', 'emily', 'matilda', 'brian', 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
      },
      translate_if_needed: { type: 'boolean', default: true }
    },
    additionalProperties: false
  },
  app_start_summary: {
    type: 'object',
    properties: {
      target_language: { type: 'string', minLength: 2, maxLength: 80 },
      effort_level: { type: 'string', enum: ['standard', 'high'] },
      include_highlights: { type: 'boolean', default: true }
    },
    additionalProperties: false
  },
  app_start_cue_translation: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      target_language: { type: 'string', minLength: 2, maxLength: 80 }
    },
    required: ['id', 'target_language'],
    additionalProperties: false
  },
  app_start_cue_transcription: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 }
    },
    required: ['id'],
    additionalProperties: false
  },
  app_start_merge: {
    type: 'object',
    properties: {
      output_path: { type: 'string', minLength: 1 },
      confirm_overwrite: { type: 'string', enum: ['OVERWRITE'] },
      history_id: { type: 'string', minLength: 1 },
      style: { type: 'string', enum: ['Default', 'Classic', 'Boxed', 'LineBox'] },
      display_mode: { type: 'string', enum: ['original', 'translation', 'dual'] }
    },
    required: ['output_path'],
    additionalProperties: false
  },
  app_processing_status: { 
    type: 'object', 
    properties: {
      history_id: { type: 'string', minLength: 1 }
    },
    additionalProperties: false 
  },
  app_processing_cancel: { type: 'object', properties: {}, additionalProperties: false },
  app_subtitles_get: {
    type: 'object',
    properties: {
      offset: { type: 'integer', minimum: 0, default: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      history_id: { type: 'string', minLength: 1 }
    },
    additionalProperties: false
  },
  app_subtitles_update: {
    type: 'object',
    properties: {
      cues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', minLength: 1 },
            text: { type: 'string' },
            translation: { type: 'string' }
          },
          required: ['id']
        }
      }
    },
    required: ['cues'],
    additionalProperties: false
  },
  app_subtitles_mutate: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['DELETE', 'SPLIT', 'MERGE'] },
      id: { type: 'string', minLength: 1 },
      split_at_ms: { type: 'integer', minimum: 0 },
      merge_with_next: { type: 'boolean' }
    },
    required: ['action', 'id'],
    additionalProperties: false
  },
  app_subtitles_export: {
    type: 'object',
    properties: {
      output_path: { type: 'string', minLength: 1 },
      confirm_overwrite: { type: 'string', enum: ['OVERWRITE'] },
      history_id: { type: 'string', minLength: 1 }
    },
    required: ['output_path'],
    additionalProperties: false
  },
  app_start_media_workflow: {
    type: 'object',
    properties: {
      url: { type: 'string', format: 'uri' },
      path: { type: 'string', minLength: 1 },
      quality: {
        type: 'string',
        enum: ['high', 'mid', 'low', '4320p', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'],
        default: '1080p'
      },
      run_to: { type: 'string', enum: ['download', 'transcribe', 'translate', 'dub', 'summary'] },
      target_language: { type: 'string', minLength: 2, maxLength: 80 },
      summary_effort_level: { type: 'string', enum: ['standard', 'high'] },
      include_highlights: { type: 'boolean', default: true },
      voice: {
        type: 'string',
        enum: ['rachel', 'adam', 'josh', 'sarah', 'charlie', 'emily', 'matilda', 'brian', 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
      },
      replace_subtitles: { type: 'string', enum: ['fail', 'discard', 'save'], default: 'fail' }
    },
    additionalProperties: false
  }
};

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

async function ensureConnected() {
  if (socket) return; // Already connected
  
  const socketPath = getSocketPath();
  const maxRetries = 3;
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        socket = createConnection(socketPath);
        
        let localBuffer = '';
        
        socket.on('connect', () => {
          console.error(`[packaged-mcp] Connected to ${socketPath}`);
          resolve();
        });
        
        socket.on('data', (data) => {
          localBuffer += data.toString();
          const lines = localBuffer.split('\n');
          localBuffer = lines.pop() || '';
          
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
          socket = null;
          reject(err);
        });
        
        socket.on('end', () => {
          console.error('[packaged-mcp] Connection closed');
          socket = null;
        });
      });
      
      return; // Success
    } catch (err) {
      lastError = err;
      console.error(`[packaged-mcp] Connection attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error(
    `Failed to connect after ${maxRetries} attempts. ` +
    `Make sure Translator.app is running with agent control enabled. ` +
    `Last error: ${lastError?.message || 'unknown'}`
  );
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
    // Special mappings from mcp.mjs (exact field transformations)
    if (key === 'confirm_overwrite' && value === 'OVERWRITE') {
      mapped.overwrite = true;
    } else if (key === 'result_ids') {
      mapped.ids = value; // NOT resultIds - startSuggestedVideoBatch expects ids
    } else if (key === 'output_path') {
      mapped.outputPath = value;
    } else if (key === 'target_language') {
      mapped.targetLanguage = value;
    } else if (key === 'replace_subtitles') {
      mapped.replaceSubtitles = value;
    } else if (key === 'run_to') {
      mapped.runTo = value;
    } else if (key === 'effort_level') {
      mapped.effortLevel = value;
    } else if (key === 'summary_effort_level') {
      mapped.summaryEffortLevel = value;
    } else if (key === 'translate_if_needed') {
      mapped.translateIfNeeded = value;
    } else if (key === 'preferred_language') {
      mapped.preferredLanguage = value;
    } else if (key === 'include_highlights') {
      mapped.includeHighlights = value;
    } else if (key === 'include_download_history') {
      mapped.includeDownloadHistory = value;
    } else if (key === 'include_watched_channels') {
      mapped.includeWatchedChannels = value;
    } else if (key === 'source_srt') {
      mapped.sourceSrt = value;
    } else if (key === 'source_language') {
      mapped.sourceLanguage = value;
    } else if (key === 'existing_translation_srt') {
      mapped.existingTranslationSrt = value;
    } else if (key === 'target_country') {
      mapped.targetCountry = value;
    } else if (key === 'history_id') {
      mapped.historyId = value;
    } else if (key === 'display_mode') {
      mapped.displayMode = value;
    } else {
      // Generic snake_to_camel for any remaining fields
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
        inputSchema: TOOL_SCHEMAS[name] || {
          type: 'object',
          properties: {},
          additionalProperties: false
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
      
      // Connect to Translator socket (lazy, with retries)
      await ensureConnected();
      
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
  // Start MCP stdio server immediately (no socket required for handshake)
  process.stdin.on('data', (chunk) => {
    readContentLengthMessage(chunk.toString('utf8'));
  });
  
  console.error('[packaged-mcp] MCP server ready (will connect to Translator on first tool call)');
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

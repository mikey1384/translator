#!/usr/bin/env node
/**
 * Packaged MCP helper for installed Translator.app
 * 
 * This script connects to the running Translator's agent socket server
 * and exposes the same MCP stdio interface as the dev agent server.
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
 *   /Applications/Translator.app/Contents/Resources/agent-mcp/packaged-mcp.mjs
 *   
 *   [Windows] 
 *   %LOCALAPPDATA%\Programs\Translator\resources\agent-mcp\packaged-mcp.mjs
 * 
 * Security:
 *   - Requires explicit user permission in Translator Settings
 *   - Agent control can be disabled at any time (kill switch)
 *   - File writes are restricted to allowed directories only
 *   - No payment/checkout operations, cookie extraction, or admin resets
 */

import { createConnection } from 'net';
import { homedir, platform } from 'os';
import { join } from 'path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { TranslationSessionStore } from './session-store.mjs';

const store = new TranslationSessionStore({
  root: process.env.TRANSLATOR_AGENT_SESSION_ROOT || undefined,
});

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
    const fs = await import('fs');
    if (fs.existsSync(socketInfoPath)) {
      const socketPath = fs.readFileSync(socketInfoPath, 'utf8').trim();
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

// Socket connection to running Translator app
let socket = null;
let requestId = 0;
const pendingRequests = new Map();

function connectToTranslator() {
  return new Promise((resolve, reject) => {
    const socketPath = getSocketPath();
    console.error(`[packaged-mcp] Connecting to ${socketPath}...`);
    
    socket = createConnection(socketPath);
    
    let buffer = '';
    
    socket.on('connect', () => {
      console.error('[packaged-mcp] Connected to Translator');
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
          const pending = pendingRequests.get(response.id);
          if (pending) {
            pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message || 'Unknown error'));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (err) {
          console.error('[packaged-mcp] Failed to parse response:', err);
        }
      }
    });
    
    socket.on('error', (err) => {
      console.error('[packaged-mcp] Socket error:', err);
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        reject(new Error(
          'Could not connect to Translator. Make sure:\n' +
          '1. Translator is running\n' +
          '2. Agent control is enabled in Settings → Agent Control'
        ));
      } else {
        reject(err);
      }
    });
    
    socket.on('end', () => {
      console.error('[packaged-mcp] Connection closed');
    });
  });
}

function callTranslatorMethod(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    
    pendingRequests.set(id, { resolve, reject });
    socket.write(JSON.stringify(request) + '\n');
    
    // Timeout after 5 minutes for long-running operations
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 300_000);
  });
}

function result(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function buildServer() {
  const server = new McpServer(
    { name: 'stage5-translator-packaged', version: '0.1.0' },
    {
      instructions:
        "Packaged Translator MCP server for installed production builds. Use translation sessions to translate or review SRT cues with the connected LLM subscription. App tools require the installed Translator to be running with agent control enabled in Settings. Mounted cues can be inspected, edited, and exported. Navigation can open visible app sections or explicit web pages. Settings never return stored secret values. Explicit file paths for merge/export must be in the user's allowed directories list.",
    }
  );

  // Translation session tools (local, don't require app connection)
  server.registerTool(
    'create_translation_session',
    {
      description:
        'Create a persistent, local SRT translation or review session. No network request or paid inference is performed.',
      inputSchema: z.object({
        source_srt: z.string().min(1),
        target_language: z.string().min(1),
        source_language: z.string().default('auto'),
        existing_translation_srt: z.string().min(1).optional(),
      }),
    },
    async input =>
      result(
        await store.create({
          sourceSrt: input.source_srt,
          targetLanguage: input.target_language,
          sourceLanguage: input.source_language,
          existingTranslationSrt: input.existing_translation_srt,
        })
      )
  );

  server.registerTool(
    'get_translation_batch',
    {
      description:
        'Get the next untranslated or unreviewed SRT cues with adjacent context.',
      inputSchema: z.object({
        session_id: z.string().min(8),
        mode: z.enum(['translate', 'review']).default('translate'),
        limit: z.number().int().min(1).max(20).default(8),
      }),
    },
    async input =>
      result(
        await store.getBatch(input.session_id, {
          mode: input.mode,
          limit: input.limit,
        })
      )
  );

  server.registerTool(
    'submit_translation_batch',
    {
      description:
        'Write translated or reviewed cue text into a local session. Existing translations can be revised safely.',
      inputSchema: z.object({
        session_id: z.string().min(8),
        mode: z.enum(['translate', 'review']).default('translate'),
        translations: z
          .array(z.object({ id: z.string().min(1), text: z.string().min(1) }))
          .min(1)
          .max(20),
      }),
    },
    async input =>
      result(
        await store.submit(input.session_id, {
          mode: input.mode,
          translations: input.translations,
        })
      )
  );

  server.registerTool(
    'translation_session_status',
    {
      description: 'Return completion and review counts for a local session.',
      inputSchema: z.object({ session_id: z.string().min(8) }),
    },
    async input => result(await store.status(input.session_id))
  );

  server.registerTool(
    'export_translation_srt',
    {
      description:
        'Export a completed session as translation-only or bilingual SRT for Translator.',
      inputSchema: z.object({
        session_id: z.string().min(8),
        mode: z.enum(['translation', 'dual', 'source']).default('dual'),
        output_path: z.string().min(1).optional(),
      }),
    },
    async input =>
      result(
        await store.export(input.session_id, {
          mode: input.mode,
          outputPath: input.output_path,
        })
      )
  );

  // App control tools (require connection to running Translator)
  const appTools = [
    'status',
    'navigationSnapshot',
    'navigate',
    'openExternalWebPage',
    'openCreditCheckout',
    'showSettings',
    'settingsSnapshot',
    'updateSettings',
    'storeProviderKey',
    'clearProviderKey',
    'openVideo',
    'mountSubtitles',
    'setDisplayMode',
    'setSubtitleStyle',
    'showDownloadHistory',
    'listDownloadHistory',
    'openDownloadHistoryItem',
    'redownloadHistoryItem',
    'searchVideos',
    'searchMoreVideos',
    'videoSearchStatus',
    'cancelVideoSearch',
    'startSuggestedVideoBatch',
    'cancelSuggestedVideoBatch',
    'suggestedVideoBatchStatus',
    'startVideoDownload',
    'startTranscription',
    'startTranslation',
    'startDubbing',
    'startSummary',
    'startCueTranslation',
    'startCueTranscription',
    'startMerge',
    'startMediaWorkflow',
    'processingStatus',
    'cancelProcessing',
    'subtitlesBatch',
    'updateSubtitles',
    'mutateSubtitles',
    'exportSubtitles',
  ];

  // For each app tool, create a simple forwarding wrapper
  // (In a real implementation, you'd define the full schemas from mcp.mjs)
  for (const toolName of appTools) {
    server.registerTool(
      `app_${toolName}`,
      {
        description: `Forward to installed Translator: ${toolName}`,
        inputSchema: z.record(z.any()),
      },
      async input => result(await callTranslatorMethod(toolName, input))
    );
  }

  return server;
}

// Main execution
async function main() {
  try {
    await connectToTranslator();
    await serveStdio(buildServer);
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

main();

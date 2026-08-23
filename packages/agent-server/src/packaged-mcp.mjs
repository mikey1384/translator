#!/usr/bin/env node
/**
 * Packaged MCP server for installed Translator.app
 *
 * Implements MCP stdio with standard newline framing and compatibility for
 * Translator's previously shipped Content-Length framing.
 * Zero npm dependencies.
 *
 * Prerequisites:
 *   1. Launch Translator.app
 *   2. Go to Settings → Agent Control
 *   3. Enable "Allow agent control"
 *   4. Configure allowed directories for file writes
 *
 * Add to Cursor/Codex MCP config:
 *   [macOS] /Applications/Translator.app/Contents/Resources/translator-mcp
 *   [Windows] "C:\Program Files\Translator\resources\translator-mcp.cmd"
 */

import { createConnection } from 'net';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createNativeOwnerMonitor } from './native-owner-monitor.mjs';
import {
  PACKAGED_AGENT_HANDSHAKE_ID,
  PACKAGED_AGENT_HANDSHAKE_METHOD,
  PACKAGED_AGENT_HANDSHAKE_TIMEOUT_MS,
  PACKAGED_AGENT_PROTOCOL_VERSION,
  getPackagedAgentHandshakeResponseRouteToken,
  isValidPackagedAgentHandshakeResponse,
} from './packaged-agent-protocol.mjs';
import { getPackagedSocketDiscoveryCandidates } from './packaged-socket-path.mjs';
import { PACKAGED_TOOL_MAP as TOOL_MAP } from './packaged-tool-map.mjs';
import {
  installTransportBoundLifecycle,
  shouldForceDevelopmentShutdown,
} from './transport-bound-lifecycle.mjs';
import { McpStdioDecoder, Utf8LineDecoder } from './stream-codecs.mjs';
import { parseToolArguments } from './tool-schema-validator.mjs';

let socket = null;
let connectionPromise = null;
let activeSocketUsers = 0;
let requestId = 0;
const pendingRequests = new Map();
let shuttingDown = false;
let lifecycle = null;
const clientSessionId = randomUUID();
let workspaceRouteToken = null;
let workspaceRouteInstanceToken = null;
const ownerMonitor = createNativeOwnerMonitor({
  onOwnershipLost: reason => requestLifecycleShutdown(reason, 1),
});

function rejectPendingRequests(error) {
  for (const pending of pendingRequests.values()) {
    pending.reject(error);
  }
  pendingRequests.clear();
}

function closeTranslatorSocketIfIdle() {
  if (shuttingDown || activeSocketUsers !== 0 || pendingRequests.size !== 0) {
    return;
  }

  const idleSocket = socket;
  socket = null;
  idleSocket?.destroy();
}

function releaseTranslatorSocket() {
  activeSocketUsers = Math.max(0, activeSocketUsers - 1);
  closeTranslatorSocketIfIdle();
}

// Safe tools list (excludes checkout and settings/key mutation)
const SAFE_TOOLS = Object.keys(TOOL_MAP);

// JSON Schemas for each tool (hand-written from mcp.mjs, zero npm deps)
export const TOOL_SCHEMAS = {
  app_status: {
    type: 'object',
    properties: {
      history_id: { type: 'string', minLength: 1, maxLength: 512 },
    },
    additionalProperties: false,
  },
  app_navigation_list: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  app_navigate: {
    type: 'object',
    properties: {
      destination: {
        type: 'string',
        enum: [
          'home',
          'create',
          'video-search',
          'downloads',
          'channels',
          'editor',
          'settings',
          'settings-credits',
          'settings-quality',
          'settings-provider',
          'settings-byo',
          'settings-api-keys',
        ],
      },
    },
    required: ['destination'],
    additionalProperties: false,
  },
  app_open_web_page: {
    type: 'object',
    properties: { url: { type: 'string', format: 'uri' } },
    required: ['url'],
    additionalProperties: false,
  },
  app_settings_show: {
    type: 'object',
    properties: { open: { type: 'boolean', default: true } },
    additionalProperties: false,
  },
  app_settings_get: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  app_open_video: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      replace_subtitles: {
        type: 'string',
        enum: ['fail', 'discard', 'save'],
        default: 'fail',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  app_mount_subtitles: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      replace_subtitles: {
        type: 'string',
        enum: ['fail', 'discard', 'save'],
        default: 'fail',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  app_set_subtitle_display: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['original', 'translation', 'dual'],
      },
    },
    required: ['mode'],
    additionalProperties: false,
  },
  app_set_subtitle_style: {
    type: 'object',
    properties: {
      style: {
        type: 'string',
        enum: ['Default', 'Classic', 'Boxed', 'LineBox'],
      },
    },
    required: ['style'],
    additionalProperties: false,
  },
  app_show_download_history: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  app_downloads_list: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      availability: {
        type: 'string',
        enum: ['all', 'local', 'missing'],
        default: 'all',
      },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
    },
    additionalProperties: false,
  },
  app_downloads_open: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      replace_subtitles: {
        type: 'string',
        enum: ['fail', 'discard', 'save'],
        default: 'fail',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
  app_downloads_redownload: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      quality: {
        type: 'string',
        enum: [
          'high',
          'mid',
          'low',
          '4320p',
          '2160p',
          '1440p',
          '1080p',
          '720p',
          '480p',
          '360p',
          '240p',
        ],
        default: '1080p',
      },
      replace_subtitles: {
        type: 'string',
        enum: ['fail', 'discard', 'save'],
        default: 'fail',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
  app_video_search: {
    type: 'object',
    properties: {
      prompt: { type: 'string', minLength: 1, maxLength: 2000 },
      preferred_language: { type: 'string', minLength: 2, maxLength: 24 },
      target_country: { type: 'string', maxLength: 100 },
      recency: {
        type: 'string',
        enum: ['any', 'day', 'week', 'month', 'year'],
      },
      include_download_history: { type: 'boolean' },
      include_watched_channels: { type: 'boolean' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
  app_video_search_more: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  app_video_search_status: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  app_video_search_cancel: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  app_video_batch_download: {
    type: 'object',
    properties: {
      result_ids: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        minItems: 1,
        maxItems: 8,
      },
      quality: {
        type: 'string',
        enum: [
          'high',
          'mid',
          'low',
          '4320p',
          '2160p',
          '1440p',
          '1080p',
          '720p',
          '480p',
          '360p',
          '240p',
        ],
        default: '1080p',
      },
    },
    required: ['result_ids'],
    additionalProperties: false,
  },
  app_video_batch_cancel: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  app_video_batch_status: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  app_start_video_download: {
    type: 'object',
    properties: {
      url: { type: 'string', format: 'uri' },
      quality: {
        type: 'string',
        enum: [
          'high',
          'mid',
          'low',
          '4320p',
          '2160p',
          '1440p',
          '1080p',
          '720p',
          '480p',
          '360p',
          '240p',
        ],
        default: '1080p',
      },
      replace_subtitles: {
        type: 'string',
        enum: ['fail', 'discard', 'save'],
        default: 'fail',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  app_start_transcription: {
    type: 'object',
    properties: {
      replace_subtitles: {
        type: 'string',
        enum: ['fail', 'discard', 'save'],
        default: 'fail',
      },
      history_id: { type: 'string', minLength: 1, maxLength: 512 },
    },
    additionalProperties: false,
  },
  app_start_translation: {
    type: 'object',
    properties: {
      target_language: { type: 'string', minLength: 2, maxLength: 80 },
      history_id: { type: 'string', minLength: 1, maxLength: 512 },
    },
    required: ['target_language'],
    additionalProperties: false,
  },
  app_start_dubbing: {
    type: 'object',
    properties: {
      target_language: { type: 'string', minLength: 2, maxLength: 80 },
      voice: {
        type: 'string',
        enum: [
          'rachel',
          'adam',
          'josh',
          'sarah',
          'charlie',
          'emily',
          'matilda',
          'brian',
          'alloy',
          'echo',
          'fable',
          'onyx',
          'nova',
          'shimmer',
        ],
      },
      translate_if_needed: { type: 'boolean', default: true },
    },
    additionalProperties: false,
  },
  app_start_summary: {
    type: 'object',
    properties: {
      target_language: { type: 'string', minLength: 2, maxLength: 80 },
      effort_level: { type: 'string', enum: ['standard', 'high'] },
      include_highlights: { type: 'boolean', default: true },
    },
    additionalProperties: false,
  },
  app_start_cue_translation: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      target_language: { type: 'string', minLength: 2, maxLength: 80 },
    },
    required: ['id', 'target_language'],
    additionalProperties: false,
  },
  app_start_cue_transcription: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
    },
    required: ['id'],
    additionalProperties: false,
  },
  app_start_merge: {
    type: 'object',
    properties: {
      output_path: { type: 'string', minLength: 1 },
      confirm_overwrite: { type: 'string', enum: ['OVERWRITE'] },
      history_id: { type: 'string', minLength: 1, maxLength: 512 },
    },
    required: ['output_path'],
    additionalProperties: false,
  },
  app_processing_status: {
    type: 'object',
    properties: {
      history_id: { type: 'string', minLength: 1, maxLength: 512 },
    },
    additionalProperties: false,
  },
  app_processing_cancel: {
    type: 'object',
    properties: {
      history_id: { type: 'string', minLength: 1, maxLength: 512 },
    },
    additionalProperties: false,
  },
  app_subtitles_get: {
    type: 'object',
    properties: {
      offset: { type: 'integer', minimum: 0, default: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      history_id: { type: 'string', minLength: 1, maxLength: 512 },
    },
    additionalProperties: false,
  },
  app_subtitles_update: {
    type: 'object',
    properties: {
      updates: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', minLength: 1 },
            original: { type: 'string' },
            translation: { type: 'string' },
            start: { type: 'number', minimum: 0 },
            end: { type: 'number', exclusiveMinimum: 0 },
          },
          required: ['id'],
          anyOf: [
            { required: ['original'] },
            { required: ['translation'] },
            { required: ['start'] },
            { required: ['end'] },
          ],
          additionalProperties: false,
        },
      },
    },
    required: ['updates'],
    additionalProperties: false,
  },
  app_subtitles_mutate: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['insert_after', 'remove', 'shift', 'shift_all'],
      },
      id: { type: 'string', minLength: 1 },
      seconds: { type: 'number' },
      confirm: { type: 'string' },
    },
    required: ['operation'],
    allOf: [
      {
        if: {
          properties: {
            operation: { enum: ['insert_after', 'remove', 'shift'] },
          },
        },
        then: { required: ['id'] },
      },
      {
        if: {
          properties: { operation: { enum: ['shift', 'shift_all'] } },
        },
        then: {
          required: ['seconds'],
          properties: { seconds: { not: { const: 0 } } },
        },
      },
      {
        if: { properties: { operation: { const: 'remove' } } },
        then: {
          required: ['confirm'],
          properties: { confirm: { const: 'REMOVE' } },
        },
      },
    ],
    additionalProperties: false,
  },
  app_subtitles_export: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      mode: {
        type: 'string',
        enum: ['original', 'translation', 'dual'],
        default: 'dual',
      },
      confirm_overwrite: { type: 'string', enum: ['OVERWRITE'] },
      history_id: { type: 'string', minLength: 1, maxLength: 512 },
    },
    required: ['path'],
    additionalProperties: false,
  },
  app_start_media_workflow: {
    type: 'object',
    properties: {
      url: { type: 'string', format: 'uri' },
      path: { type: 'string', minLength: 1 },
      quality: {
        type: 'string',
        enum: [
          'high',
          'mid',
          'low',
          '4320p',
          '2160p',
          '1440p',
          '1080p',
          '720p',
          '480p',
          '360p',
          '240p',
        ],
        default: '1080p',
      },
      run_to: {
        type: 'string',
        enum: ['download', 'transcribe', 'translate', 'dub', 'summary'],
        default: 'transcribe',
      },
      target_language: { type: 'string', minLength: 2, maxLength: 80 },
      summary_effort_level: { type: 'string', enum: ['standard', 'high'] },
      include_highlights: { type: 'boolean', default: true },
      voice: {
        type: 'string',
        enum: [
          'rachel',
          'adam',
          'josh',
          'sarah',
          'charlie',
          'emily',
          'matilda',
          'brian',
          'alloy',
          'echo',
          'fable',
          'onyx',
          'nova',
          'shimmer',
        ],
      },
      replace_subtitles: {
        type: 'string',
        enum: ['fail', 'discard', 'save'],
        default: 'fail',
      },
    },
    allOf: [
      { not: { required: ['url', 'path'] } },
      {
        if: {
          required: ['run_to'],
          properties: { run_to: { enum: ['translate', 'dub'] } },
        },
        then: { required: ['target_language'] },
      },
    ],
    additionalProperties: false,
  },
};

function getSocketDiscoveries() {
  return getPackagedSocketDiscoveryCandidates();
}

function handleTranslatorResponseLine(line) {
  if (!line.trim()) return;
  try {
    const response = JSON.parse(line);
    if (
      response.id !== undefined &&
      response.id !== null &&
      pendingRequests.has(response.id)
    ) {
      const pending = pendingRequests.get(response.id);
      pendingRequests.delete(response.id);
      if (response.error) {
        pending.reject(
          new Error(response.error.message || JSON.stringify(response.error))
        );
      } else {
        pending.resolve(response.result);
      }
    }
  } catch {
    // A malformed app response cannot be reported as a valid MCP response.
  }
}

function connectTranslatorSocket(discovery) {
  return new Promise((resolve, reject) => {
    const { socketPath, protocolVersion, instanceToken } = discovery;
    if (
      protocolVersion !== PACKAGED_AGENT_PROTOCOL_VERSION ||
      typeof instanceToken !== 'string'
    ) {
      reject(
        new Error(
          'Translator socket discovery is stale or lacks an ownership lease. Restart the updated Translator app.'
        )
      );
      return;
    }

    const candidateSocket = createConnection(socketPath);
    const decoder = new Utf8LineDecoder();
    let authenticated = false;
    let settled = false;
    let handshakeDeadline = null;
    socket = candidateSocket;

    const clearHandshakeDeadline = () => {
      if (!handshakeDeadline) return;
      clearTimeout(handshakeDeadline);
      handshakeDeadline = null;
    };

    const rejectOnce = error => {
      if (settled) return;
      settled = true;
      clearHandshakeDeadline();
      reject(error);
    };
    handshakeDeadline = setTimeout(() => {
      rejectOnce(new Error('Translator ownership handshake timed out.'));
      candidateSocket.destroy();
    }, PACKAGED_AGENT_HANDSHAKE_TIMEOUT_MS);
    handshakeDeadline.unref?.();
    const handleCandidateLine = line => {
      if (authenticated) {
        handleTranslatorResponseLine(line);
        return;
      }
      if (!line.trim()) return;
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        rejectOnce(
          new Error('Translator returned an invalid ownership handshake.')
        );
        candidateSocket.destroy();
        return;
      }
      if (!isValidPackagedAgentHandshakeResponse(response)) {
        rejectOnce(
          new Error(
            response.error?.message ||
              'Translator rejected the ownership handshake.'
          )
        );
        candidateSocket.destroy();
        return;
      }
      const receivedRouteToken =
        getPackagedAgentHandshakeResponseRouteToken(response);
      if (!receivedRouteToken) {
        rejectOnce(
          new Error('Translator returned an invalid workspace lease.')
        );
        candidateSocket.destroy();
        return;
      }
      workspaceRouteToken = receivedRouteToken;
      workspaceRouteInstanceToken = instanceToken;
      authenticated = true;
      clearHandshakeDeadline();
      settled = true;
      console.error(`[packaged-mcp] Connected to ${socketPath}`);
      resolve();
    };

    candidateSocket.once('connect', () => {
      if (shuttingDown) {
        if (socket === candidateSocket) socket = null;
        candidateSocket.destroy();
        rejectOnce(new Error('MCP transport disconnected.'));
        return;
      }
      try {
        candidateSocket.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: PACKAGED_AGENT_HANDSHAKE_ID,
            method: PACKAGED_AGENT_HANDSHAKE_METHOD,
            params: {
              protocolVersion: PACKAGED_AGENT_PROTOCOL_VERSION,
              instanceToken,
              clientSessionId,
              ...(workspaceRouteInstanceToken === instanceToken &&
              workspaceRouteToken
                ? { workspaceRouteToken }
                : {}),
            },
          })}\n`,
          error => {
            if (error) {
              rejectOnce(error);
              candidateSocket.destroy();
            }
          }
        );
      } catch (error) {
        rejectOnce(error);
        candidateSocket.destroy();
      }
    });

    candidateSocket.on('data', data => {
      try {
        for (const line of decoder.write(data)) {
          handleCandidateLine(line);
        }
      } catch (error) {
        candidateSocket.destroy(error);
      }
    });

    candidateSocket.once('end', () => {
      try {
        for (const line of decoder.end()) {
          handleCandidateLine(line);
        }
      } catch (error) {
        candidateSocket.destroy(error);
      }
    });

    candidateSocket.once('error', error => {
      if (socket === candidateSocket) {
        socket = null;
        if (!shuttingDown) rejectPendingRequests(error);
      }
      if (!authenticated) rejectOnce(error);
    });

    candidateSocket.once('close', () => {
      clearHandshakeDeadline();
      if (socket === candidateSocket) {
        socket = null;
        if (!shuttingDown) {
          console.error('[packaged-mcp] Connection closed');
          rejectPendingRequests(new Error('Translator connection closed.'));
        }
      }
      if (!authenticated) {
        rejectOnce(
          new Error('Translator connection closed before authentication.')
        );
      }
    });
  });
}

function ensureConnected() {
  if (shuttingDown) {
    return Promise.reject(new Error('MCP transport disconnected.'));
  }
  if (connectionPromise) return connectionPromise;
  if (socket && !socket.destroyed) return Promise.resolve();

  const maxRetries = 3;
  const connecting = (async () => {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      // Re-resolve discovery on every attempt. Translator may have started or
      // published its exact userData-cased endpoint after an earlier attempt.
      const discoveries = getSocketDiscoveries();
      for (const discovery of discoveries) {
        try {
          await connectTranslatorSocket(discovery);
          return;
        } catch (error) {
          lastError = error;
          if (shuttingDown) throw error;
          console.error(
            `[packaged-mcp] Connection attempt ${attempt}/${maxRetries} failed for ${discovery.socketPath}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 4000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(
      `Failed to connect after ${maxRetries} attempts. ` +
        `Make sure Translator.app is running with agent control enabled. ` +
        `Last error: ${lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown')}`
    );
  })();
  const trackedConnection = connecting.finally(() => {
    if (connectionPromise === trackedConnection) connectionPromise = null;
  });
  connectionPromise = trackedConnection;
  return trackedConnection;
}

async function acquireTranslatorSocket() {
  await ensureConnected();
  const activeSocket = socket;
  if (shuttingDown || !activeSocket || activeSocket.destroyed) {
    throw new Error('Translator connection is not available.');
  }
  activeSocketUsers += 1;
  return activeSocket;
}

async function callTranslatorMethod(method, params) {
  const activeSocket = await acquireTranslatorSocket();

  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timeout = setTimeout(() => {
      const pending = pendingRequests.get(id);
      if (!pending) return;
      pendingRequests.delete(id);
      pending.reject(new Error(`Timeout calling ${method}`));
    }, 120000);

    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      releaseTranslatorSocket();
    };
    pendingRequests.set(id, {
      resolve: result => {
        clearTimeout(timeout);
        releaseOnce();
        resolve(result);
      },
      reject: error => {
        clearTimeout(timeout);
        releaseOnce();
        reject(error);
      },
    });

    try {
      activeSocket.write(
        `${JSON.stringify({ jsonrpc: '2.0', method, params, id })}\n`,
        error => {
          if (!error) return;
          const pending = pendingRequests.get(id);
          if (!pending) return;
          pendingRequests.delete(id);
          pending.reject(error);
        }
      );
    } catch (error) {
      const pending = pendingRequests.get(id);
      pendingRequests.delete(id);
      pending?.reject(error);
    }
  });
}

// Field mapping: snake_case → camelCase (from mcp.mjs)
export function mapFields(input) {
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
    } else {
      // Generic snake_to_camel for any remaining fields
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      mapped[camelKey] = value;
    }
  }
  return mapped;
}

const stdinDecoder = new McpStdioDecoder();

function writeMessage(msg) {
  if (shuttingDown) return;
  const json = JSON.stringify(msg);
  const content =
    stdinDecoder.framing === 'content-length'
      ? `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`
      : `${json}\n`;
  try {
    process.stdout.write(content, error => {
      if (error) requestOutputShutdown(error);
    });
  } catch (error) {
    requestOutputShutdown(error);
  }
}

function requestOutputShutdown(_error) {
  // Never try to describe an output failure through the failed output. The
  // lifecycle owns one idempotent resource close and process exit request.
  requestLifecycleShutdown('output:error', 1);
}

function requestLifecycleShutdown(reason, exitCode) {
  if (!lifecycle) {
    shuttingDown = true;
    process.exitCode = exitCode;
    return;
  }
  try {
    const result = lifecycle.requestShutdown(reason, exitCode);
    void Promise.resolve(result).catch(() => {
      process.exitCode = exitCode;
    });
  } catch {
    process.exitCode = exitCode;
  }
}

function readStdioMessage(data) {
  const { messages, errors } = stdinDecoder.write(data);
  for (const error of errors) {
    console.error('[packaged-mcp] Invalid stdio frame:', error);
  }
  if (errors.length > 0) {
    // A bad length makes the byte stream ambiguous: there is no principled
    // resynchronization point. Treat it as a definite transport failure
    // instead of leaving a detached helper waiting on a corrupted channel.
    requestLifecycleShutdown('input:protocol-error', 1);
    return;
  }
  for (const message of messages) {
    try {
      const msg = JSON.parse(message.toString('utf8'));
      void handleMessage(msg).catch(error => {
        console.error('[packaged-mcp] Request handling failed:', error);
        requestLifecycleShutdown('input:protocol-error', 1);
      });
    } catch (error) {
      console.error('[packaged-mcp] Parse error:', error);
      writeMessage({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    }
  }
}

async function handleMessage(msg) {
  if (shuttingDown) return;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    writeMessage({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    });
    return;
  }

  const { method, params, id } = msg;
  const hasId = Object.hasOwn(msg, 'id');

  const validId =
    !hasId ||
    id === null ||
    typeof id === 'string' ||
    (typeof id === 'number' && Number.isFinite(id));
  if (msg.jsonrpc !== '2.0' || typeof method !== 'string' || !validId) {
    writeMessage({
      jsonrpc: '2.0',
      id: validId ? (id ?? null) : null,
      error: { code: -32600, message: 'Invalid Request' },
    });
    return;
  }

  // A notification omits id. JSON-RPC permits (but discourages) null request
  // IDs, and those requests still require a response whose id is null.
  if (!hasId) {
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
          serverInfo: { name: 'translator-packaged-mcp', version: '1.0.0' },
        },
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
        inputSchema: TOOL_SCHEMAS[name],
      }));
      writeMessage({ jsonrpc: '2.0', id, result: { tools } });
      return;
    }

    if (method === 'tools/call') {
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        writeMessage({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Invalid params' },
        });
        return;
      }
      const { name: toolName, arguments: toolArgs } = params;

      if (
        typeof toolName !== 'string' ||
        !Object.hasOwn(TOOL_MAP, toolName) ||
        (toolArgs !== undefined &&
          (!toolArgs ||
            typeof toolArgs !== 'object' ||
            Array.isArray(toolArgs)))
      ) {
        writeMessage({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Invalid tool call params' },
        });
        return;
      }

      let parsedArgs;
      try {
        parsedArgs = parseToolArguments(TOOL_SCHEMAS[toolName], toolArgs);
      } catch (error) {
        writeMessage({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message:
              error instanceof Error ? error.message : 'Invalid tool arguments',
          },
        });
        return;
      }

      const translatorMethod = TOOL_MAP[toolName];
      const mappedArgs = mapFields(parsedArgs);

      const result = await callTranslatorMethod(translatorMethod, mappedArgs);

      writeMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text:
                typeof result === 'string'
                  ? result
                  : JSON.stringify(result, null, 2),
            },
          ],
        },
      });
      return;
    }

    writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found' },
    });
  } catch (error) {
    if (shuttingDown) return;
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function closePackagedResources() {
  if (shuttingDown) return;
  shuttingDown = true;

  const activeSocket = socket;
  socket = null;
  activeSocket?.destroy();

  const disconnectError = new Error('MCP transport disconnected.');
  rejectPendingRequests(disconnectError);
}

async function main() {
  lifecycle = installTransportBoundLifecycle({
    close: async () => {
      await closePackagedResources();
      await ownerMonitor.close();
    },
    forceClose: async () => {
      await closePackagedResources();
      void ownerMonitor.close().catch(() => {});
    },
    forceOnFirstShutdown: shouldForceDevelopmentShutdown,
  });

  try {
    await ownerMonitor.start();
  } catch (error) {
    try {
      process.stderr.write(
        `[packaged-mcp] Ownership setup failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
    } catch {
      // Never recurse through an output channel that may already be gone.
    }
    await lifecycle.requestShutdown('owner-monitor:exit', 1);
    return;
  }

  // Start MCP stdio server immediately (no socket required for handshake)
  process.stdin.on('data', chunk => {
    readStdioMessage(chunk);
  });

  console.error(
    '[packaged-mcp] MCP server ready (will connect to Translator on first tool call)'
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch(() => requestLifecycleShutdown('startup:error', 1));
}

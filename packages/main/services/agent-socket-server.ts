import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { Server as NetServer, Socket } from 'node:net';
import path from 'node:path';
import { app, BrowserWindow, type WebContents } from 'electron';
import log from 'electron-log';
import { PACKAGED_AGENT_METHODS } from '../../agent-server/src/packaged-tool-map.mjs';
import {
  createPackagedSocketDiscovery,
  getValidPackagedAgentHandshake,
  PACKAGED_AGENT_HANDSHAKE_ID,
  PACKAGED_AGENT_HANDSHAKE_TIMEOUT_MS,
  PACKAGED_AGENT_PROTOCOL_VERSION,
} from '../../agent-server/src/packaged-agent-protocol.mjs';
import { callAgentMethod } from '../handlers/agent-bridge-handlers.js';
import { settingsStore } from '../store/settings-store.js';
import { AgentClientSessionRouteRegistry } from '../utils/agent-client-session-routing.js';
import { Utf8LineDecoder } from '../utils/utf8-line-decoder.js';
import { getActiveAppWebContents } from '../utils/window.js';

const ALLOWED_AGENT_METHODS = new Set(PACKAGED_AGENT_METHODS);

class AgentProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

function isRequestObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

interface AgentSocketServerOptions {
  onUnexpectedFailure?: (error: Error) => unknown;
}

export class AgentSocketServer {
  private server: NetServer | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private stopping = false;
  private readonly socketDirectory: string;
  private readonly socketPath: string;
  private readonly socketInfoPath: string;
  private readonly clients = new Set<Socket>();
  private readonly authenticatedClients = new Set<Socket>();
  private readonly clientRouteTokens = new Map<Socket, string>();
  private readonly clientSessionRoutes =
    new AgentClientSessionRouteRegistry<WebContents>(randomUUID);
  private readonly clientAbortControllers = new Map<Socket, AbortController>();
  private readonly onUnexpectedFailure?: (error: Error) => unknown;
  private unexpectedFailureServer: NetServer | null = null;
  private mainWindow: BrowserWindow | null;
  private instanceToken = randomBytes(32).toString('hex');

  constructor(
    mainWindow: BrowserWindow,
    { onUnexpectedFailure }: AgentSocketServerOptions = {}
  ) {
    this.mainWindow = mainWindow;
    this.onUnexpectedFailure = onUnexpectedFailure;

    const userData = app.getPath('userData');
    const socketDirectory = path.join(userData, 'agent');
    this.socketDirectory = socketDirectory;

    if (process.platform === 'win32') {
      const sanitized = userData.replace(/[^a-zA-Z0-9]/g, '_');
      this.socketPath = `\\\\.\\pipe\\translator-agent-${sanitized}`;
    } else {
      this.socketPath = path.join(socketDirectory, 'translator-agent.sock');
    }
    this.socketInfoPath = path.join(socketDirectory, 'socket-path.txt');
  }

  setMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
  }

  start(): Promise<void> {
    if (this.stopPromise) return this.stopPromise.then(() => this.start());
    if (this.startPromise) return this.startPromise;
    if (this.server?.listening && !this.stopping) return Promise.resolve();

    try {
      this.ensureSocketDirectory();
    } catch (error) {
      return Promise.reject(error);
    }

    this.removeSocketFile();
    this.removeSocketInfoFile();
    this.clientSessionRoutes.clear();
    this.instanceToken = randomBytes(32).toString('hex');
    const server = new NetServer(socket => this.acceptClient(server, socket));
    this.server = server;
    let opening = true;

    const starting = new Promise<void>((resolve, reject) => {
      server.on('error', error => {
        log.error('[AgentSocketServer] Server error:', error);
        if (!opening) {
          if (this.server === server && !this.stopping) {
            this.reportUnexpectedFailure(server, error);
            void this.stop();
          }
          return;
        }
        opening = false;
        if (this.server === server) this.server = null;
        reject(error);
      });

      server.once('close', () => {
        if (this.server !== server) return;
        this.server = null;
        this.removeSocketFile();
        this.removeSocketInfoFile();
        if (!this.stopping) {
          const error = new Error('Agent socket server closed unexpectedly.');
          log.error('[AgentSocketServer] Server closed unexpectedly.');
          this.reportUnexpectedFailure(server, error);
        }
      });

      try {
        server.listen(this.socketPath, () => {
          if (!opening) return;
          try {
            if (!this.stopping) this.publishSocketDiscovery();
            opening = false;
            resolve();
          } catch (error) {
            opening = false;
            if (this.server === server) this.server = null;
            // A helper can connect as soon as the private endpoint starts
            // listening, before discovery publication finishes. Reap that
            // exact partial-start client set so server.close() cannot wait
            // forever after publication or permission setup fails.
            this.disconnectClients();
            try {
              server.close(() => {
                this.removeSocketFile();
                this.removeSocketInfoFile();
                reject(error);
              });
            } catch {
              this.removeSocketFile();
              this.removeSocketInfoFile();
              reject(error);
            }
          }
        });
      } catch (error) {
        opening = false;
        if (this.server === server) this.server = null;
        reject(error);
      }
    });

    const trackedStart = starting
      .catch(error => {
        this.removeSocketFile();
        this.removeSocketInfoFile();
        throw error;
      })
      .finally(() => {
        if (this.startPromise === trackedStart) this.startPromise = null;
      });
    this.startPromise = trackedStart;
    return trackedStart;
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;

    const stopping = (async () => {
      await this.startPromise?.catch(() => {});
      const server = this.server;
      if (this.server === server) this.server = null;

      this.disconnectClients();

      if (server?.listening) {
        await new Promise<void>(resolve => {
          server.close(error => {
            if (error) {
              log.warn(
                '[AgentSocketServer] Error while stopping server:',
                error
              );
            }
            resolve();
          });
        });
        log.info('[AgentSocketServer] Server stopped');
      }

      this.removeSocketFile();
      this.removeSocketInfoFile();
    })();

    const trackedStop = stopping.finally(() => {
      if (this.stopPromise === trackedStop) this.stopPromise = null;
      this.stopping = false;
    });
    this.stopPromise = trackedStop;
    return trackedStop;
  }

  private acceptClient(server: NetServer, socket: Socket): void {
    if (this.stopping || this.server !== server) {
      socket.destroy();
      return;
    }

    log.info('[AgentSocketServer] Client connected');
    this.clients.add(socket);
    const abortController = new AbortController();
    this.clientAbortControllers.set(socket, abortController);
    const decoder = new Utf8LineDecoder();
    const handshakeDeadline = setTimeout(() => {
      if (!this.authenticatedClients.has(socket)) socket.destroy();
    }, PACKAGED_AGENT_HANDSHAKE_TIMEOUT_MS);
    handshakeDeadline.unref?.();
    const clearHandshakeDeadline = () => clearTimeout(handshakeDeadline);
    socket.setTimeout(PACKAGED_AGENT_HANDSHAKE_TIMEOUT_MS);
    socket.once('timeout', () => {
      if (!this.authenticatedClients.has(socket)) socket.destroy();
    });

    socket.on('data', data => {
      try {
        for (const line of decoder.write(data)) this.handleLine(socket, line);
        if (this.authenticatedClients.has(socket)) clearHandshakeDeadline();
      } catch (error) {
        log.warn('[AgentSocketServer] Closing oversized client frame:', error);
        socket.destroy();
      }
    });
    socket.once('end', () => {
      try {
        for (const line of decoder.end()) this.handleLine(socket, line);
      } catch (error) {
        log.warn('[AgentSocketServer] Closing oversized client frame:', error);
        socket.destroy();
      }
    });
    socket.once('error', error => {
      abortController.abort();
      log.error('[AgentSocketServer] Socket error:', error);
    });
    socket.once('close', () => {
      clearHandshakeDeadline();
      this.clients.delete(socket);
      this.authenticatedClients.delete(socket);
      this.clientRouteTokens.delete(socket);
      this.clientAbortControllers.delete(socket);
      abortController.abort();
      log.info('[AgentSocketServer] Client disconnected');
    });
  }

  private disconnectClients(): void {
    for (const client of this.clients) {
      this.clientAbortControllers.get(client)?.abort();
      client.destroy();
    }
    this.clients.clear();
    this.authenticatedClients.clear();
    this.clientRouteTokens.clear();
    this.clientSessionRoutes.clear();
    this.clientAbortControllers.clear();
  }

  private reportUnexpectedFailure(server: NetServer, error: Error): void {
    if (this.unexpectedFailureServer === server) return;
    this.unexpectedFailureServer = server;

    try {
      const result = this.onUnexpectedFailure?.(error);
      void Promise.resolve(result).catch(() => {});
    } catch {
      // The socket has already failed. The callback is best-effort state
      // reconciliation and must not create an unhandled failure of its own.
    }
  }

  private handleLine(socket: Socket, line: string): void {
    if (!line.trim()) return;

    try {
      const request = JSON.parse(line);
      if (!this.authenticatedClients.has(socket)) {
        this.handleHandshake(socket, request);
        return;
      }
      const id = isRequestObject(request) ? request.id : null;
      const validId =
        typeof id === 'string' ||
        (typeof id === 'number' && Number.isFinite(id));
      if (
        !isRequestObject(request) ||
        request.jsonrpc !== '2.0' ||
        typeof request.method !== 'string' ||
        !validId
      ) {
        this.writeResponse(socket, {
          jsonrpc: '2.0',
          id: validId ? id : null,
          error: { code: -32600, message: 'Invalid Request' },
        });
        return;
      }

      void this.handleRequest(socket, request).catch(error => {
        // handleRequest contains its own protocol error boundary. This final
        // observer guarantees a secondary logger/response failure cannot turn
        // a hostile socket frame into an unhandled rejection.
        try {
          log.error('[AgentSocketServer] Unhandled request failure:', error);
        } catch {
          // Global output failure handling owns shutdown if logging is broken.
        }
        socket.destroy();
      });
    } catch (error) {
      log.error('[AgentSocketServer] Failed to parse request:', error);
      if (!this.authenticatedClients.has(socket)) {
        socket.destroy();
        return;
      }
      this.writeResponse(socket, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    }
  }

  private handleHandshake(socket: Socket, request: unknown): void {
    const id = isRequestObject(request) ? request.id : null;
    const handshake = getValidPackagedAgentHandshake(
      request,
      this.instanceToken
    );

    if (!handshake) {
      const response = `${JSON.stringify({
        jsonrpc: '2.0',
        id:
          typeof id === 'string' ||
          (typeof id === 'number' && Number.isFinite(id))
            ? id
            : null,
        error: {
          code: -32001,
          message: 'Packaged agent ownership handshake rejected.',
        },
      })}\n`;
      try {
        socket.end(response);
      } catch {
        socket.destroy();
      }
      return;
    }

    let routeToken: string;
    try {
      routeToken = this.clientSessionRoutes.bind(
        handshake.clientSessionId,
        handshake.workspaceRouteToken,
        getActiveAppWebContents()
      ).routeToken;
    } catch (error) {
      const response = `${JSON.stringify({
        jsonrpc: '2.0',
        id: PACKAGED_AGENT_HANDSHAKE_ID,
        error: {
          code: -32002,
          message: error instanceof Error ? error.message : String(error),
        },
      })}\n`;
      try {
        socket.end(response);
      } catch {
        socket.destroy();
      }
      return;
    }

    this.authenticatedClients.add(socket);
    this.clientRouteTokens.set(socket, routeToken);
    socket.setTimeout(0);
    this.writeResponse(socket, {
      jsonrpc: '2.0',
      id: PACKAGED_AGENT_HANDSHAKE_ID,
      result: {
        protocolVersion: PACKAGED_AGENT_PROTOCOL_VERSION,
        workspaceRouteToken: routeToken,
      },
    });
  }

  private publishSocketDiscovery(): void {
    log.info(`[AgentSocketServer] Listening on ${this.socketPath}`);
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(this.socketPath, 0o600);
      } catch (error) {
        throw new Error(
          'Failed to secure the packaged agent socket endpoint.',
          { cause: error }
        );
      }
    }

    try {
      fs.writeFileSync(
        this.socketInfoPath,
        `${JSON.stringify(
          createPackagedSocketDiscovery(this.socketPath, this.instanceToken)
        )}\n`,
        {
          encoding: 'utf8',
          mode: 0o600,
        }
      );
      if (process.platform !== 'win32') {
        fs.chmodSync(this.socketInfoPath, 0o600);
      }
      log.info(
        `[AgentSocketServer] Wrote socket path to ${this.socketInfoPath}`
      );
    } catch (error) {
      this.removeSocketInfoFile();
      throw new Error(
        'Failed to publish the packaged agent socket discovery file.',
        { cause: error }
      );
    }
  }

  private ensureSocketDirectory(): void {
    try {
      fs.mkdirSync(this.socketDirectory, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') {
        fs.chmodSync(this.socketDirectory, 0o700);
      }
    } catch (error) {
      throw new Error(
        'Failed to create or secure the packaged agent socket directory.',
        { cause: error }
      );
    }
  }

  private removeSocketFile(): void {
    if (process.platform === 'win32' || !fs.existsSync(this.socketPath)) return;
    try {
      fs.unlinkSync(this.socketPath);
    } catch (error) {
      log.warn('[AgentSocketServer] Failed to remove socket file:', error);
    }
  }

  private removeSocketInfoFile(): void {
    if (!fs.existsSync(this.socketInfoPath)) return;
    try {
      fs.unlinkSync(this.socketInfoPath);
    } catch (error) {
      log.warn('[AgentSocketServer] Failed to remove socket info:', error);
    }
  }

  private writeResponse(socket: Socket, response: unknown): void {
    if (socket.destroyed || !socket.writable) return;
    try {
      socket.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      log.error('[AgentSocketServer] Failed to write response:', error);
    }
  }

  private async handleRequest(
    socket: Socket,
    request: Record<string, unknown>
  ): Promise<void> {
    const { method, params, id } = request;
    const signal = this.clientAbortControllers.get(socket)?.signal;

    try {
      const agentEnabled =
        settingsStore.get('agentControlEnabled', false) === true;
      if (!agentEnabled) {
        throw new Error(
          'Agent control is disabled. Enable it in Settings → Agent Control.'
        );
      }

      if (typeof method !== 'string' || !ALLOWED_AGENT_METHODS.has(method)) {
        throw new AgentProtocolError(
          -32601,
          `Method ${String(method)} is not available through packaged agent control.`
        );
      }
      if (params !== undefined && !isRequestObject(params)) {
        throw new AgentProtocolError(
          -32602,
          'Agent method params must be a JSON object.'
        );
      }
      if (!signal || signal.aborted) return;

      const routeToken = this.clientRouteTokens.get(socket);
      if (!routeToken) {
        throw new Error('Packaged agent workspace lease is unavailable.');
      }
      const sessionTarget = this.clientSessionRoutes.resolve(routeToken);

      const mainWindow = this.mainWindow;
      if (!mainWindow || mainWindow.isDestroyed()) {
        throw new Error('Main window not available');
      }

      const result = await callAgentMethod(
        method,
        params || {},
        signal,
        sessionTarget
      );
      this.writeResponse(socket, { jsonrpc: '2.0', id, result });
    } catch (error: any) {
      if (signal?.aborted) return;
      log.error('[AgentSocketServer] Request failed:', error);
      this.writeResponse(socket, {
        jsonrpc: '2.0',
        id,
        error: {
          code: error instanceof AgentProtocolError ? error.code : -32603,
          message: error?.message || String(error),
        },
      });
    }
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  getSocketInfoPath(): string {
    return this.socketInfoPath;
  }

  isRunning(): boolean {
    return Boolean(this.server?.listening && !this.stopping);
  }

  getConnectedClientCount(): number {
    return this.clients.size;
  }

  getAuthenticatedClientCount(): number {
    return this.authenticatedClients.size;
  }
}

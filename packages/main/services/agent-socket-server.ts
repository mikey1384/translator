import { Server as NetServer, Socket } from 'net';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import log from 'electron-log';
import { getActiveAppWebContents } from '../utils/window.js';

export class AgentSocketServer {
  private server: NetServer | null = null;
  private socketPath: string;
  private clients: Set<Socket> = new Set();

  constructor() {
    // Use a named pipe on Windows, Unix socket on Mac/Linux
    if (process.platform === 'win32') {
      this.socketPath = '\\\\.\\pipe\\translator-agent';
    } else {
      const socketDir = path.join(app.getPath('userData'), 'agent');
      if (!fs.existsSync(socketDir)) {
        fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
      }
      this.socketPath = path.join(socketDir, 'translator-agent.sock');
    }
  }

  async start(): Promise<void> {
    if (this.server) {
      log.info('[AgentSocketServer] Server already running');
      return;
    }

    // Clean up any existing socket file
    if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch (err) {
        log.warn('[AgentSocketServer] Failed to remove existing socket:', err);
      }
    }

    return new Promise((resolve, reject) => {
      this.server = new NetServer((socket) => {
        log.info('[AgentSocketServer] Client connected');
        this.clients.add(socket);

        let buffer = '';

        socket.on('data', (data) => {
          buffer += data.toString();
          
          // Process complete JSON-RPC messages (newline-delimited)
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
              const request = JSON.parse(line);
              void this.handleRequest(socket, request);
            } catch (err) {
              log.error('[AgentSocketServer] Failed to parse request:', err);
              const errorResponse = {
                jsonrpc: '2.0',
                id: null,
                error: {
                  code: -32700,
                  message: 'Parse error',
                },
              };
              socket.write(JSON.stringify(errorResponse) + '\n');
            }
          }
        });

        socket.on('end', () => {
          log.info('[AgentSocketServer] Client disconnected');
          this.clients.delete(socket);
        });

        socket.on('error', (err) => {
          log.error('[AgentSocketServer] Socket error:', err);
          this.clients.delete(socket);
        });
      });

      this.server.on('error', (err) => {
        log.error('[AgentSocketServer] Server error:', err);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        log.info(`[AgentSocketServer] Listening on ${this.socketPath}`);
        // Set restrictive permissions on Unix sockets
        if (process.platform !== 'win32') {
          try {
            fs.chmodSync(this.socketPath, 0o600);
          } catch (err) {
            log.warn('[AgentSocketServer] Failed to set socket permissions:', err);
          }
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve) => {
      // Close all client connections
      for (const client of this.clients) {
        client.destroy();
      }
      this.clients.clear();

      this.server!.close(() => {
        log.info('[AgentSocketServer] Server stopped');
        
        // Clean up socket file on Unix
        if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
          try {
            fs.unlinkSync(this.socketPath);
          } catch (err) {
            log.warn('[AgentSocketServer] Failed to remove socket file:', err);
          }
        }
        
        this.server = null;
        resolve();
      });
    });
  }

  private async handleRequest(socket: Socket, request: any): Promise<void> {
    const { method, params, id } = request;

    try {
      // Forward the request to the renderer's translator-agent bridge
      const webContents = getActiveAppWebContents();
      if (!webContents) {
        throw new Error('No active Translator window');
      }

      // Execute the method on the translator-agent bridge
      const result = await webContents.executeJavaScript(`
        (async () => {
          if (!window.translatorAgent) {
            throw new Error('Agent control is not enabled. Enable it in Settings → Agent Control.');
          }
          const method = ${JSON.stringify(method)};
          const params = ${JSON.stringify(params)};
          const fn = window.translatorAgent[method];
          if (typeof fn !== 'function') {
            throw new Error('Unknown agent method: ' + method);
          }
          return await fn(params);
        })();
      `);

      const response = {
        jsonrpc: '2.0',
        id,
        result,
      };

      socket.write(JSON.stringify(response) + '\n');
    } catch (error: any) {
      log.error('[AgentSocketServer] Request failed:', error);
      const errorResponse = {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: error?.message || String(error),
        },
      };
      socket.write(JSON.stringify(errorResponse) + '\n');
    }
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  isRunning(): boolean {
    return this.server !== null;
  }
}

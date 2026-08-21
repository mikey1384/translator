import { Server as NetServer, Socket } from 'net';
import path from 'path';
import fs from 'fs';
import { app, BrowserWindow } from 'electron';
import log from 'electron-log';
import { callAgentMethod } from '../handlers/agent-bridge-handlers.js';

export class AgentSocketServer {
  private server: NetServer | null = null;
  private socketPath: string;
  private socketInfoPath: string;
  private clients: Set<Socket> = new Set();
  private mainWindow: BrowserWindow | null = null;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    
    // Use userData path consistently across platforms
    const userData = app.getPath('userData');
    const socketDir = path.join(userData, 'agent');
    
    // Ensure agent directory exists with restrictive permissions
    if (!fs.existsSync(socketDir)) {
      fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    }
    
    // Platform-specific socket path
    if (process.platform === 'win32') {
      // Use per-user named pipe under userData (not well-known name)
      const sanitized = userData.replace(/[^a-zA-Z0-9]/g, '_');
      this.socketPath = `\\\\.\\pipe\\translator-agent-${sanitized}`;
    } else {
      // Unix socket
      this.socketPath = path.join(socketDir, 'translator-agent.sock');
    }
    
    // Write socket path info file for helper discovery
    this.socketInfoPath = path.join(socketDir, 'socket-path.txt');
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
        
        // Write socket path info file for helper discovery
        try {
          fs.writeFileSync(this.socketInfoPath, this.socketPath, {
            encoding: 'utf8',
            mode: 0o600,
          });
          log.info(`[AgentSocketServer] Wrote socket path to ${this.socketInfoPath}`);
        } catch (err) {
          log.warn('[AgentSocketServer] Failed to write socket info:', err);
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
        
        // Clean up socket info file
        if (fs.existsSync(this.socketInfoPath)) {
          try {
            fs.unlinkSync(this.socketInfoPath);
          } catch (err) {
            log.warn('[AgentSocketServer] Failed to remove socket info:', err);
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
      // Check that main window is still available
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        throw new Error('Main window not available');
      }

      // Forward the request via secure IPC bridge (not executeJavaScript)
      const result = await callAgentMethod(method, params || {});

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

  getSocketInfoPath(): string {
    return this.socketInfoPath;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getConnectedClientCount(): number {
    return this.clients.size;
  }
}

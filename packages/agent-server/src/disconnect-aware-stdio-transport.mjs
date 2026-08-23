import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

/** Makes the SDK transport's close observable by the owning process. */
export class DisconnectAwareStdioServerTransport extends StdioServerTransport {
  constructor({
    input = process.stdin,
    output = process.stdout,
    onDisconnect,
  } = {}) {
    super(input, output);
    this.onDisconnect = onDisconnect;
    this.closePromise = null;
  }

  close() {
    if (this.closePromise) return this.closePromise;

    this.closePromise = super.close().finally(() => {
      try {
        this.onDisconnect?.();
      } catch {
        // The transport is already closed; its callback cannot report here.
      }
    });
    return this.closePromise;
  }
}

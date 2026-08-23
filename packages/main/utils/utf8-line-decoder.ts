import { StringDecoder } from 'node:string_decoder';

const DEFAULT_MAX_PENDING_CHARACTERS = 16 * 1024 * 1024;

/** Preserves UTF-8 code points split across arbitrary stream chunks. */
export class Utf8LineDecoder {
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private readonly maxPendingCharacters: number;

  constructor(maxPendingCharacters = DEFAULT_MAX_PENDING_CHARACTERS) {
    if (
      !Number.isSafeInteger(maxPendingCharacters) ||
      maxPendingCharacters < 1
    ) {
      throw new RangeError('maxPendingCharacters must be a positive integer.');
    }
    this.maxPendingCharacters = maxPendingCharacters;
  }

  write(chunk: Buffer): string[] {
    this.buffer += this.decoder.write(chunk);
    const lines = this.takeCompleteLines();
    this.assertPendingLimit();
    return lines;
  }

  end(chunk?: Buffer): string[] {
    this.buffer += this.decoder.end(chunk);
    const lines = this.takeCompleteLines();
    this.assertPendingLimit();
    if (this.buffer) lines.push(this.buffer);
    this.buffer = '';
    return lines;
  }

  private assertPendingLimit(): void {
    if (this.buffer.length <= this.maxPendingCharacters) return;
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    throw new Error('UTF-8 line exceeds the configured size limit.');
  }

  private takeCompleteLines(): string[] {
    const parts = this.buffer.split('\n');
    this.buffer = parts.pop() ?? '';
    return parts.map(line => (line.endsWith('\r') ? line.slice(0, -1) : line));
  }
}

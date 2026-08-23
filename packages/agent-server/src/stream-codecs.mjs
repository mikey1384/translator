import { StringDecoder } from 'node:string_decoder';

const HEADER_SEPARATOR = Buffer.from('\r\n\r\n', 'ascii');
const CONTENT_LENGTH_PREFIX = Buffer.from('content-length:', 'ascii');
const DEFAULT_MAX_PENDING_CHARACTERS = 16 * 1024 * 1024;
const DEFAULT_MAX_HEADER_BYTES = 8 * 1024;
const DEFAULT_MAX_CONTENT_BYTES = 16 * 1024 * 1024;

/** Preserves UTF-8 code points split across arbitrary stream chunks. */
export class Utf8LineDecoder {
  constructor({ maxPendingCharacters = DEFAULT_MAX_PENDING_CHARACTERS } = {}) {
    if (
      !Number.isSafeInteger(maxPendingCharacters) ||
      maxPendingCharacters < 1
    ) {
      throw new RangeError('maxPendingCharacters must be a positive integer.');
    }
    this.decoder = new StringDecoder('utf8');
    this.buffer = '';
    this.maxPendingCharacters = maxPendingCharacters;
  }

  write(chunk) {
    this.buffer += this.decoder.write(chunk);
    const lines = this.takeCompleteLines();
    this.assertPendingLimit();
    return lines;
  }

  end(chunk) {
    this.buffer += this.decoder.end(chunk);
    const lines = this.takeCompleteLines();
    this.assertPendingLimit();
    if (this.buffer) lines.push(this.buffer);
    this.buffer = '';
    return lines;
  }

  assertPendingLimit() {
    if (this.buffer.length <= this.maxPendingCharacters) return;
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    throw new Error('UTF-8 line exceeds the configured size limit.');
  }

  takeCompleteLines() {
    const parts = this.buffer.split('\n');
    this.buffer = parts.pop() ?? '';
    return parts.map(line => (line.endsWith('\r') ? line.slice(0, -1) : line));
  }
}

/** Parses Content-Length frames by bytes, never by JavaScript string length. */
export class ContentLengthDecoder {
  constructor({
    maxHeaderBytes = DEFAULT_MAX_HEADER_BYTES,
    maxContentBytes = DEFAULT_MAX_CONTENT_BYTES,
  } = {}) {
    if (!Number.isSafeInteger(maxHeaderBytes) || maxHeaderBytes < 1) {
      throw new RangeError('maxHeaderBytes must be a positive integer.');
    }
    if (!Number.isSafeInteger(maxContentBytes) || maxContentBytes < 1) {
      throw new RangeError('maxContentBytes must be a positive integer.');
    }
    this.buffer = Buffer.alloc(0);
    this.expectedLength = null;
    this.discardRemaining = 0;
    this.maxHeaderBytes = maxHeaderBytes;
    this.maxContentBytes = maxContentBytes;
  }

  write(chunk) {
    let incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (this.discardRemaining > 0) {
      const discarded = Math.min(this.discardRemaining, incoming.length);
      this.discardRemaining -= discarded;
      incoming = incoming.subarray(discarded);
      if (!incoming.length) return { messages: [], errors: [] };
    }
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, incoming])
      : incoming;
    const messages = [];
    const errors = [];

    while (true) {
      if (this.expectedLength === null) {
        const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
        if (headerEnd === -1) {
          if (this.buffer.length > this.maxHeaderBytes) {
            this.buffer = Buffer.alloc(0);
            errors.push(
              new Error(
                'Content-Length header exceeds the configured size limit.'
              )
            );
          }
          break;
        }

        if (headerEnd > this.maxHeaderBytes) {
          this.buffer = Buffer.alloc(0);
          errors.push(
            new Error(
              'Content-Length header exceeds the configured size limit.'
            )
          );
          break;
        }

        const header = this.buffer.subarray(0, headerEnd).toString('ascii');
        this.buffer = this.buffer.subarray(headerEnd + HEADER_SEPARATOR.length);
        const contentLengthValues = header
          .split('\r\n')
          .map(line => line.match(/^Content-Length:\s*(\d+)\s*$/i))
          .filter(Boolean)
          .map(match => match[1]);
        const length =
          contentLengthValues.length === 1
            ? Number(contentLengthValues[0])
            : Number.NaN;
        if (!Number.isSafeInteger(length) || length < 0) {
          errors.push(new Error('Invalid Content-Length header.'));
          continue;
        }
        if (length > this.maxContentBytes) {
          errors.push(
            new Error('Content-Length body exceeds the configured size limit.')
          );
          const discarded = Math.min(length, this.buffer.length);
          this.buffer = this.buffer.subarray(discarded);
          this.discardRemaining = length - discarded;
          if (this.discardRemaining > 0) break;
          continue;
        }
        this.expectedLength = length;
      }

      if (this.buffer.length < this.expectedLength) break;
      messages.push(this.buffer.subarray(0, this.expectedLength));
      this.buffer = this.buffer.subarray(this.expectedLength);
      this.expectedLength = null;
    }

    return { messages, errors };
  }
}

/**
 * Accepts the MCP SDK's newline-delimited stdio binding while retaining the
 * legacy Content-Length binding shipped by earlier Translator releases. The
 * first bytes select one exact framing for the process lifetime; frames are
 * never guessed or resynchronized across modes.
 */
export class McpStdioDecoder {
  constructor({ maxLineCharacters, ...contentLengthOptions } = {}) {
    this.contentLengthDecoder = new ContentLengthDecoder(contentLengthOptions);
    this.lineDecoder = new Utf8LineDecoder(
      maxLineCharacters === undefined
        ? undefined
        : { maxPendingCharacters: maxLineCharacters }
    );
    this.preface = Buffer.alloc(0);
    this.framing = null;
  }

  write(chunk) {
    let incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (this.framing === null) {
      this.preface = this.preface.length
        ? Buffer.concat([this.preface, incoming])
        : incoming;
      const comparedLength = Math.min(
        this.preface.length,
        CONTENT_LENGTH_PREFIX.length
      );
      const compared = this.preface
        .subarray(0, comparedLength)
        .toString('ascii')
        .toLowerCase();
      const prefixMatches = CONTENT_LENGTH_PREFIX.toString(
        'ascii',
        0,
        comparedLength
      ).startsWith(compared);
      if (prefixMatches && this.preface.length < CONTENT_LENGTH_PREFIX.length) {
        return { framing: null, messages: [], errors: [] };
      }

      this.framing = prefixMatches ? 'content-length' : 'newline';
      incoming = this.preface;
      this.preface = Buffer.alloc(0);
    }

    if (this.framing === 'content-length') {
      return {
        framing: this.framing,
        ...this.contentLengthDecoder.write(incoming),
      };
    }

    try {
      const messages = this.lineDecoder
        .write(incoming)
        .filter(line => line.trim())
        .map(line => Buffer.from(line, 'utf8'));
      return { framing: this.framing, messages, errors: [] };
    } catch (error) {
      return { framing: this.framing, messages: [], errors: [error] };
    }
  }
}

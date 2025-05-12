export class SubtitleProcessingError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SubtitleProcessingError';
  }
}

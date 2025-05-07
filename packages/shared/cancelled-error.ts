export class CancelledError extends Error {
  public readonly isCancelled = true;
  constructor() {
    super('Cancelled by user');
    this.name = 'CancelledError';
  }
}

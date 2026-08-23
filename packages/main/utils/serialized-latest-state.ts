/**
 * Serializes async state transitions while making every queued transition read
 * the newest requested state. Once shutdown is requested, later callers can
 * only reinforce the terminal state.
 */
export class SerializedLatestState<T> {
  private desiredState: T;
  private terminalState: { value: T } | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    initialState: T,
    private readonly applyState: (state: T) => Promise<void>
  ) {
    this.desiredState = initialState;
  }

  set(state: T): Promise<void> {
    if (this.terminalState === null) this.desiredState = state;
    return this.enqueue();
  }

  shutdown(finalState: T): Promise<void> {
    this.terminalState = { value: finalState };
    this.desiredState = finalState;
    return this.enqueue();
  }

  private enqueue(): Promise<void> {
    const operation = this.queue.then(() =>
      this.applyState(
        this.terminalState === null
          ? this.desiredState
          : this.terminalState.value
      )
    );
    // A failed transition remains visible to its caller but cannot poison all
    // later transitions, including a terminal shutdown retry.
    this.queue = operation.catch(() => {});
    return operation;
  }
}

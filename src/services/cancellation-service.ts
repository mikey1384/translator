import { ChildProcess } from 'child_process';

// Single source of truth for all operations
export class CancellationService {
  private static instance: CancellationService;

  // Operations map stores both FFmpeg processes and AbortControllers
  private operations = new Map<
    string,
    {
      controller?: AbortController;
      process?: ChildProcess;
    }
  >();

  private constructor() {
    // Private constructor to enforce singleton
  }

  public static getInstance(): CancellationService {
    if (!this.instance) {
      this.instance = new CancellationService();
    }
    return this.instance;
  }

  /**
   * Register an operation with an AbortController
   */
  public registerOperation(
    operationId: string,
    controller: AbortController
  ): void {
    console.log(
      `[CancellationService] Registering operation ${operationId} with controller`
    );
    const existingOp = this.operations.get(operationId) || {};
    this.operations.set(operationId, {
      ...existingOp,
      controller,
    });
  }

  /**
   * Register an FFmpeg process for an operation
   */
  public registerProcess(operationId: string, process: ChildProcess): void {
    console.log(
      `[CancellationService] Registering process ${process.pid} for operation ${operationId}`
    );
    const existingOp = this.operations.get(operationId) || {};
    this.operations.set(operationId, {
      ...existingOp,
      process,
    });
  }

  /**
   * Unregister an operation completely
   */
  public unregisterOperation(operationId: string): void {
    console.log(`[CancellationService] Unregistering operation ${operationId}`);
    this.operations.delete(operationId);
  }

  /**
   * Check if an operation is active
   * @returns true if operation is registered and not cancelled, false if cancelled, undefined if never registered
   */
  public isOperationActive(operationId: string): boolean | undefined {
    const operation = this.getOperation(operationId);
    if (!operation) {
      return undefined; // Operation ID not found in the map
    }
    // Check the signal status if a controller exists
    if (operation.controller?.signal.aborted) {
      return false; // Operation exists but was cancelled via signal
    }
    // If it exists and is not aborted (or has no controller), consider it active
    return true;
  }

  /**
   * Get operation data safely
   * @returns The operation data or undefined if not found
   */
  private getOperation(operationId: string) {
    return this.operations.get(operationId);
  }

  /**
   * Check if an operation exists and is active
   */
  public hasActiveOperation(operationId: string): boolean {
    return this.operations.has(operationId);
  }

  /**
   * Cancel an operation by ID - handles both process killing and abort signals
   */
  public cancelOperation(operationId: string): boolean {
    console.log(
      `[CancellationService] Attempting to cancel operation ${operationId}`
    );

    const operation = this.getOperation(operationId);
    if (!operation) {
      console.warn(
        `[CancellationService] No operation found with ID: ${operationId}`
      );
      return false;
    }

    let cancelled = false;

    // Kill the process if one exists
    if (operation.process && !operation.process.killed) {
      console.log(
        `[CancellationService] Killing process ${operation.process.pid} for operation ${operationId}`
      );

      // Mark as explicitly cancelled
      (operation.process as any).wasCancelled = true;

      try {
        // First try SIGTERM
        const killed = operation.process.kill('SIGTERM');
        if (!killed) {
          console.warn(
            `[CancellationService] Failed to send SIGTERM to process ${operation.process.pid}, trying SIGKILL`
          );
          operation.process.kill('SIGKILL');
        }
        cancelled = true;
      } catch (error) {
        console.error(`[CancellationService] Error killing process: ${error}`);
      }
    }

    // Abort the controller if one exists
    if (operation.controller) {
      console.log(
        `[CancellationService] Aborting controller for operation ${operationId}`
      );
      try {
        // Only abort if not already aborted
        if (!operation.controller.signal.aborted) {
          operation.controller.abort();
        }
        cancelled = true; // Mark as cancelled even if already aborted
      } catch (error) {
        console.error(
          `[CancellationService] Error aborting controller: ${error}`
        );
      }
    }

    // Log the outcome
    if (cancelled) {
      console.log(
        `[CancellationService] Cancellation signals sent for operation ${operationId}`
      );
    }

    return cancelled;
  }

  /**
   * Get the abort signal for an operation
   */
  public getSignal(operationId: string): AbortSignal | undefined {
    const operation = this.getOperation(operationId);
    return operation?.controller?.signal;
  }
}

// Export a singleton instance
export const cancellationService = CancellationService.getInstance();

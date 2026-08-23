interface PendingRenderOperations {
  has(operationId: string): boolean;
}

/** Refuse to replace callbacks for an in-flight render operation. */
export function assertRenderOperationAvailable(
  pendingOperations: PendingRenderOperations,
  operationId: string
): void {
  if (pendingOperations.has(operationId)) {
    throw new Error('A render operation with this ID is already pending.');
  }
}

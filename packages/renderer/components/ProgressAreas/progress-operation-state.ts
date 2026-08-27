export function resolveProgressOperationComplete(
  progress: number,
  operationComplete?: boolean
): boolean {
  return typeof operationComplete === 'boolean'
    ? operationComplete
    : progress >= 100;
}

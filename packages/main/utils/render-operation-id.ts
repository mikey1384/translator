import { createHash } from 'node:crypto';

const MAX_RENDER_OPERATION_ID_LENGTH = 200;
const RENDER_OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;

/** Validate an operation identity before it reaches logs, maps, or paths. */
export function requireRenderOperationId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_RENDER_OPERATION_ID_LENGTH ||
    !RENDER_OPERATION_ID_PATTERN.test(value)
  ) {
    throw new Error('Invalid render operation ID.');
  }
  return value;
}

/**
 * Produce a portable, collision-resistant filename component while retaining
 * the original validated identity for protocol routing.
 */
export function renderOperationPathToken(operationId: string): string {
  const validated = requireRenderOperationId(operationId);
  const readable = validated.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
  const digest = createHash('sha256')
    .update(validated, 'utf8')
    .digest('hex')
    .slice(0, 16);
  return `${readable}-${digest}`;
}

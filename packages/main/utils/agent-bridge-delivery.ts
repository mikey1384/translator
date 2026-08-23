export class AgentBridgeResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentBridgeResponseError';
  }
}

export class AgentBridgeNotDeliveredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentBridgeNotDeliveredError';
  }
}

export class AgentBridgeDeliveryUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentBridgeDeliveryUnknownError';
  }
}

/**
 * Only an explicit renderer rejection or proven non-delivery establishes that
 * a start request did not create durable background work. Timeouts and caller
 * disconnects after send remain ambiguous, so their owner route must survive.
 */
export function isDefiniteAgentBridgeStartFailure(error: unknown): boolean {
  return (
    error instanceof AgentBridgeResponseError ||
    error instanceof AgentBridgeNotDeliveredError
  );
}

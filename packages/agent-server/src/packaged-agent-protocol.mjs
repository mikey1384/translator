import { timingSafeEqual } from 'node:crypto';

export const PACKAGED_AGENT_PROTOCOL_VERSION = 3;
export const PACKAGED_AGENT_HANDSHAKE_METHOD = 'translator/handshake';
export const PACKAGED_AGENT_HANDSHAKE_ID = 'translator-internal-handshake';
export const PACKAGED_AGENT_HANDSHAKE_TIMEOUT_MS = 5_000;
export const PACKAGED_AGENT_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PACKAGED_AGENT_ROUTE_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createPackagedSocketDiscovery(socketPath, instanceToken) {
  return {
    socketPath,
    protocolVersion: PACKAGED_AGENT_PROTOCOL_VERSION,
    instanceToken,
  };
}

export function isPackagedSocketDiscovery(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.socketPath === 'string' &&
    value.socketPath.length > 0 &&
    value.protocolVersion === PACKAGED_AGENT_PROTOCOL_VERSION &&
    typeof value.instanceToken === 'string' &&
    /^[a-f0-9]{64}$/i.test(value.instanceToken)
  );
}

export function getValidPackagedAgentHandshake(request, instanceToken) {
  const params =
    request !== null && typeof request === 'object' && !Array.isArray(request)
      ? request.params
      : null;
  const candidateToken =
    params !== null && typeof params === 'object' && !Array.isArray(params)
      ? params.instanceToken
      : null;
  if (
    typeof instanceToken !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(instanceToken) ||
    typeof candidateToken !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(candidateToken)
  ) {
    return null;
  }

  const expectedBytes = Buffer.from(instanceToken, 'utf8');
  const candidateBytes = Buffer.from(candidateToken, 'utf8');
  const clientSessionId = params.clientSessionId;
  const workspaceRouteToken = params.workspaceRouteToken ?? null;
  const valid =
    request.jsonrpc === '2.0' &&
    request.id === PACKAGED_AGENT_HANDSHAKE_ID &&
    request.method === PACKAGED_AGENT_HANDSHAKE_METHOD &&
    params.protocolVersion === PACKAGED_AGENT_PROTOCOL_VERSION &&
    typeof clientSessionId === 'string' &&
    PACKAGED_AGENT_SESSION_ID_PATTERN.test(clientSessionId) &&
    (workspaceRouteToken === null ||
      (typeof workspaceRouteToken === 'string' &&
        PACKAGED_AGENT_ROUTE_TOKEN_PATTERN.test(workspaceRouteToken))) &&
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes);

  return valid ? { clientSessionId, workspaceRouteToken } : null;
}

export function isValidPackagedAgentHandshake(request, instanceToken) {
  return getValidPackagedAgentHandshake(request, instanceToken) !== null;
}

export function isValidPackagedAgentHandshakeResponse(response) {
  return (
    response !== null &&
    typeof response === 'object' &&
    !Array.isArray(response) &&
    response.jsonrpc === '2.0' &&
    response.id === PACKAGED_AGENT_HANDSHAKE_ID &&
    !Object.hasOwn(response, 'error') &&
    response.result !== null &&
    typeof response.result === 'object' &&
    !Array.isArray(response.result) &&
    response.result.protocolVersion === PACKAGED_AGENT_PROTOCOL_VERSION &&
    typeof response.result.workspaceRouteToken === 'string' &&
    PACKAGED_AGENT_ROUTE_TOKEN_PATTERN.test(response.result.workspaceRouteToken)
  );
}

export function getPackagedAgentHandshakeResponseRouteToken(response) {
  return isValidPackagedAgentHandshakeResponse(response)
    ? response.result.workspaceRouteToken
    : null;
}

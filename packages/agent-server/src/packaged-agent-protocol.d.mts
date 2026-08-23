export declare const PACKAGED_AGENT_PROTOCOL_VERSION: 3;
export declare const PACKAGED_AGENT_HANDSHAKE_METHOD: 'translator/handshake';
export declare const PACKAGED_AGENT_HANDSHAKE_ID: 'translator-internal-handshake';
export declare const PACKAGED_AGENT_HANDSHAKE_TIMEOUT_MS: 5000;
export declare const PACKAGED_AGENT_SESSION_ID_PATTERN: RegExp;
export declare const PACKAGED_AGENT_ROUTE_TOKEN_PATTERN: RegExp;

export interface PackagedSocketDiscovery {
  socketPath: string;
  protocolVersion: typeof PACKAGED_AGENT_PROTOCOL_VERSION;
  instanceToken: string;
}

export declare function createPackagedSocketDiscovery(
  socketPath: string,
  instanceToken: string
): PackagedSocketDiscovery;
export declare function isPackagedSocketDiscovery(
  value: unknown
): value is PackagedSocketDiscovery;
export declare function isValidPackagedAgentHandshake(
  request: unknown,
  instanceToken: string
): boolean;
export interface ValidPackagedAgentHandshake {
  clientSessionId: string;
  workspaceRouteToken: string | null;
}
export declare function getValidPackagedAgentHandshake(
  request: unknown,
  instanceToken: string
): ValidPackagedAgentHandshake | null;
export declare function isValidPackagedAgentHandshakeResponse(
  response: unknown
): boolean;
export declare function getPackagedAgentHandshakeResponseRouteToken(
  response: unknown
): string | null;
